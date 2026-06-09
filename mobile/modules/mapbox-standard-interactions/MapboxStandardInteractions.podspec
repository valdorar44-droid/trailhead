require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'MapboxStandardInteractions'
  s.version        = package['version']
  s.summary        = 'Trailhead Mapbox Standard featureset interaction bridge'
  s.homepage       = 'https://gettrailhead.app'
  s.license        = 'MIT'
  s.author         = { 'Trailhead' => '' }
  s.platforms      = { :ios => '16.4' }
  s.source         = { :path => '.' }
  s.source_files   = 'ios/**/*.{swift,h,m}'
  s.dependency 'ExpoModulesCore'
  s.dependency 'MapboxMaps'
  s.dependency 'MapboxSearch', '>= 2.12.3', '< 3.0'
end
