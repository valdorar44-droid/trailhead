require 'json'

Pod::Spec.new do |s|
  s.name           = 'TileServer'
  s.version        = '1.0.0'
  s.summary        = 'Local PMTiles HTTP tile server for offline maps'
  s.homepage       = 'https://trailhead.app'
  s.license        = 'MIT'
  s.author         = { 'Trailhead' => '' }
  s.platforms      = { :ios => '14.0' }
  s.source         = { :path => '.' }
  s.source_files   = 'ios/**/*.{swift,m,h}'
  s.libraries      = 'z'
  s.dependency 'ExpoModulesCore'
end
