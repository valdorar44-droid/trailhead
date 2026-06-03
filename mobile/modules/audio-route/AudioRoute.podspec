require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'AudioRoute'
  s.version        = package['version']
  s.summary        = 'Trailhead realtime voice audio route controls'
  s.homepage       = 'https://gettrailhead.app'
  s.license        = 'MIT'
  s.author         = { 'Trailhead' => '' }
  s.platforms      = { :ios => '16.4' }
  s.source         = { :path => '.' }
  s.source_files   = 'ios/**/*.{swift,h,m}'
  s.dependency 'ExpoModulesCore'
end
