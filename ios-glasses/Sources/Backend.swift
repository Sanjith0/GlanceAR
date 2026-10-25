import Foundation
import Security

struct HarnessError: LocalizedError {
  let message: String
  var errorDescription: String? { message }
  init(_ message: String) { self.message = message }
}

struct PairingConfiguration: Codable {
  let deploymentURL: String
  let token: String
  let eventId: String?
  let conversationId: String

  func validated() throws -> PairingConfiguration {
    guard let url = URL(string: deploymentURL), url.scheme == "https",
      let host = url.host, host.hasSuffix(".convex.cloud"),
      url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
      url.port == nil, url.path.isEmpty || url.path == "/",
      token.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil,
      !conversationId.isEmpty
    else { throw HarnessError("Invalid pairing. Use the exact HTTPS Convex deployment and setup JSON from your own recorder account.") }
    return self
  }
}

struct RecordingLease: Decodable {
  let leaseUntil: Double
  let serverNow: Double
  var boundedDurationMs: Double { max(0, min(5_000, leaseUntil - serverNow)) }
}

struct PresenceTicket: Decodable {
  let ticketId: String
  let issuedAt: Double
  let expiresAt: Double
}

struct ProfileRecord: Decodable {
  let id: String
  let name: String
}

struct ConversationRecord: Decodable {
  let id: String
  let recorderId: String
  let participants: [ProfileRecord]
  let status: String
  let recordingConsent: [String]
  let exchangeConsent: [String]
  let recap: RecapRecord?
  let error: String?
  var participantIds: [String] { participants.map(\.id) }
  var summary: String? { recap?.summary }
  var bothRecordingConsent: Bool {
    Set(participantIds).count == 2 && Set(participantIds).isSubset(of: Set(recordingConsent))
  }
  var bothExchangeConsent: Bool {
    Set(participantIds).count == 2 && Set(participantIds).isSubset(of: Set(exchangeConsent))
  }
}

struct RecapRecord: Decodable {
  let summary: String
}

struct BackendSnapshot: Decodable {
  let me: ProfileRecord?
  let conversations: [ConversationRecord]
}

private struct APIResponse<T: Decodable>: Decodable {
  let status: String
  let value: T?
  let errorMessage: String?
}

/// Convex's documented HTTP API. Device token is only in POST JSON, never a URL.
final class BackendClient {
  let config: PairingConfiguration
  private let session: URLSession
  init(_ config: PairingConfiguration) {
    self.config = config
    let options = URLSessionConfiguration.ephemeral
    options.timeoutIntervalForRequest = 6
    options.timeoutIntervalForResource = 60
    options.urlCache = nil
    session = URLSession(configuration: options)
  }

  func call<T: Decodable>(_ name: String, query: Bool = false,
                          args: [String: Any] = [:], as type: T.Type) async throws -> T? {
    try Task.checkCancellation()
    let endpoint = URL(string: config.deploymentURL)!
      .appendingPathComponent("api").appendingPathComponent(query ? "query" : "mutation")
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: [
      "path": "glance:\(name)",
      "args": args.merging(["token": config.token]) { _, new in new },
      "format": "json"
    ])
    let (data, response) = try await session.data(for: request)
    try Task.checkCancellation()
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode)
    else { throw HarnessError("Backend request failed. Check connection and deployment.") }
    let envelope = try JSONDecoder().decode(APIResponse<T>.self, from: data)
    guard envelope.status == "success" else {
      throw HarnessError(envelope.errorMessage ?? "Backend denied the request.")
    }
    return envelope.value
  }

  func sessionCall<T: Decodable>(_ name: String, extra: [String: Any] = [:],
                                 as type: T.Type) async throws -> T? {
    try await call(name, args: extra.merging(["conversationId": config.conversationId]) { _, new in new }, as: type)
  }

  func mutation(_ name: String) async throws {
    let _: String? = try await sessionCall(name, as: String.self)
  }

  func snapshot() async throws -> BackendSnapshot {
    var args: [String: Any] = [:]
    if let eventId = config.eventId { args["eventId"] = eventId }
    guard let snapshot = try await call("snapshot", query: true, args: args, as: BackendSnapshot.self)
    else { throw HarnessError("No backend snapshot was returned.") }
    return snapshot
  }

  func createUploadURL() async throws -> URL {
    guard let signedURL = try await sessionCall("createUploadUrl", as: String.self),
      let url = URL(string: signedURL), url.scheme == "https",
      let host = url.host, host.hasSuffix(".convex.cloud") || host.hasSuffix(".convex.site")
    else { throw HarnessError("The backend did not provide a valid upload URL.") }
    return url
  }

  func uploadWAV(_ file: URL, to url: URL) async throws -> String {
    try Task.checkCancellation()
    let bytes = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
    guard bytes > 44, bytes <= 30_000_000 else { throw HarnessError("Recording is empty or exceeds the 30 MB limit.") }
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("audio/wav", forHTTPHeaderField: "Content-Type")
    let (data, response) = try await session.upload(for: request, fromFile: file)
    try Task.checkCancellation()
    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
      let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let storageId = object["storageId"] as? String
    else { throw HarnessError("Audio upload failed. The local file is retained for an explicit retry.") }
    return storageId
  }

  func attachAudio(storageId: String) async throws {
    let _: String? = try await sessionCall("attachAudio",
      extra: ["storageId": storageId, "mimeType": "audio/wav"], as: String.self)
  }
}

enum PairingKeychain {
  private static let service = "com.glancear.glasses.pairing"
  private static var query: [String: Any] {
    [kSecClass as String: kSecClassGenericPassword,
     kSecAttrService as String: service, kSecAttrAccount as String: "recorder"]
  }
  static func save(_ configuration: PairingConfiguration) throws {
    let data = try JSONEncoder().encode(configuration)
    let status = SecItemUpdate(query as CFDictionary,
                              [kSecValueData as String: data] as CFDictionary)
    if status == errSecItemNotFound {
      var item = query
      item[kSecValueData as String] = data
      item[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
      guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess
      else { throw HarnessError("Could not save pairing in this device's Keychain.") }
    } else if status != errSecSuccess {
      throw HarnessError("Could not update Keychain pairing.")
    }
  }
  static func load() -> PairingConfiguration? {
    var item = query
    item[kSecReturnData as String] = true
    item[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    guard SecItemCopyMatching(item as CFDictionary, &result) == errSecSuccess,
      let data = result as? Data,
      let value = try? JSONDecoder().decode(PairingConfiguration.self, from: data)
    else { return nil }
    return try? value.validated()
  }
  static func clear() { SecItemDelete(query as CFDictionary) }
}
