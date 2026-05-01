require 'json'

Pod::Spec.new do |s|
  s.name           = 'ValhallaRouting'
  s.version        = '1.0.0'
  s.summary        = 'Offline Valhalla routing for Trailhead'
  s.description    = 'Expo module that routes against downloaded Valhalla routing packs.'
  s.author         = 'Trailhead'
  s.homepage       = 'https://gettrailhead.app'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.source         = { :path => '.' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.prepare_command = <<-CMD
    set -e
    mkdir -p ios/vendor
    if [ ! -d ios/vendor/valhalla-wrapper.xcframework ]; then
      curl -L -o ios/vendor/valhalla-wrapper.xcframework.zip https://github.com/Rallista/valhalla-mobile/releases/download/0.5.1/valhalla-wrapper.xcframework.zip
      ditto -x -k ios/vendor/valhalla-wrapper.xcframework.zip ios/vendor
      rm ios/vendor/valhalla-wrapper.xcframework.zip
    fi
  CMD

  s.source_files = [
    'ios/*.{swift,h,m,mm}',
    'ios/include/**/*.{h,hpp}'
  ]
  s.public_header_files = 'ios/ValhallaWrapper.h'
  s.resources = ['ios/Resources/default.json', 'ios/Resources/tzdata.tar']
  s.vendored_frameworks = 'ios/vendor/valhalla-wrapper.xcframework'
  s.preserve_paths = 'ios/vendor/valhalla-wrapper.xcframework'
  s.libraries = ['z', 'c++', 'sqlite3', 'bz2']
  s.frameworks = ['Foundation']

  s.pod_target_xcconfig = {
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++20',
    'HEADER_SEARCH_PATHS' => [
      '$(inherited)',
      '"${PODS_TARGET_SRCROOT}/ios"',
      '"${PODS_TARGET_SRCROOT}/ios/include"',
      '"${PODS_TARGET_SRCROOT}/ios/vendor/valhalla-wrapper.xcframework/ios-arm64/Headers"',
      '"${PODS_TARGET_SRCROOT}/ios/vendor/valhalla-wrapper.xcframework/ios-arm64_x86_64-simulator/Headers"'
    ].join(' ')
  }
end
