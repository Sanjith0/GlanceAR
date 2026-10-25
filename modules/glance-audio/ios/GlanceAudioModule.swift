import ExpoModulesCore
import Foundation

public final class GlanceAudioModule: Module {
  private let capture = LeaseAudioRecorder()

  public func definition() -> ModuleDefinition {
    Name("GlanceAudio")
    Events("onAudioStopped")

    OnCreate {
      self.capture.onCaptureStopped = { [weak self] reason, uri, captureID in
        self?.sendEvent("onAudioStopped", ["reason": reason, "uri": uri as Any? ?? NSNull(), "captureID": captureID])
      }
    }
    OnDestroy { self.capture.shutdown() }

    AsyncFunction("requestPermission") { (promise: Promise) in
      self.capture.requestPermission { granted in promise.resolve(granted) }
    }
    AsyncFunction("prepare") { (captureID: String, promise: Promise) in
      self.capture.prepare(captureID: captureID) { result in
        switch result {
        case .success: promise.resolve(nil)
        case .failure(let error): promise.reject(error)
        }
      }
    }
    AsyncFunction("createLeaseTicket") { (promise: Promise) in
      self.capture.createLeaseTicket { result in
        switch result {
        case .success(let ticket): promise.resolve(ticket)
        case .failure(let error): promise.reject(error)
        }
      }
    }
    AsyncFunction("start") { (remainingMs: Double, ticket: String, captureID: String, promise: Promise) in
      self.capture.start(remainingMs: remainingMs, ticket: ticket, captureID: captureID) { result in
        switch result {
        case .success: promise.resolve(nil)
        case .failure(let error): promise.reject(error)
        }
      }
    }
    AsyncFunction("renew") { (remainingMs: Double, ticket: String, captureID: String, promise: Promise) in
      self.capture.renew(remainingMs: remainingMs, ticket: ticket, captureID: captureID) { result in
        switch result {
        case .success: promise.resolve(nil)
        case .failure(let error): promise.reject(error)
        }
      }
    }
    AsyncFunction("stop") { (captureID: String, promise: Promise) in
      self.capture.stop(captureID: captureID) { uri in
        promise.resolve(["uri": uri as Any? ?? NSNull(), "mimeType": "audio/wav"])
      }
    }
    AsyncFunction("delete") { (uri: String, promise: Promise) in
      self.capture.delete(uri: uri) { result in
        switch result {
        case .success: promise.resolve(nil)
        case .failure(let error): promise.reject(error)
        }
      }
    }
  }
}
