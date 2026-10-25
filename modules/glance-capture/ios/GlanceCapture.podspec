Pod::Spec.new do |s|
  s.name = 'GlanceCapture'
  s.version = '1.0.0'
  s.summary = 'Video-only on-device hand signal capture'
  s.description = 'An explicitly armed camera preview with Apple Vision hand pose detection. No face recognition, audio, frame storage, or network transport.'
  s.license = { :type => 'MIT' }
  s.author = 'GlanceAR'
  s.homepage = 'https://docs.expo.dev/modules/'
  s.platforms = { :ios => '16.4' }
  s.source = { :path => '.' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'AVFoundation', 'Vision', 'ImageIO', 'UIKit'
  s.swift_version = '5.0'
  s.source_files = '*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
  s.test_spec 'Tests' do |t|
    t.source_files = 'Tests/*.swift'
  end
end
