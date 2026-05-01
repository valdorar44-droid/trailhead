require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

$TrailheadTileServer ||= Object.new
$TrailheadTileServer_SPM_SPECS ||= [
  {
    url: 'https://github.com/Rallista/valhalla-mobile.git',
    requirement: {
      kind: 'exactVersion',
      version: '0.5.1'
    },
    product_name: 'Valhalla'
  },
  {
    url: 'https://github.com/Rallista/valhalla-openapi-models-swift.git',
    requirement: {
      kind: 'exactVersion',
      version: '0.2.0'
    },
    product_name: 'ValhallaConfigModels'
  }
]

def $TrailheadTileServer._add_spm_to_target(project, target, url, requirement, product_name)
  return if target.nil?

  pkg_class = Xcodeproj::Project::Object::XCRemoteSwiftPackageReference
  ref_class = Xcodeproj::Project::Object::XCSwiftPackageProductDependency
  pkg = project.root_object.package_references.find { |p| p.class == pkg_class && p.repositoryURL == url }
  if !pkg
    pkg = project.new(pkg_class)
    pkg.repositoryURL = url
    project.root_object.package_references << pkg
  end
  pkg.requirement = requirement

  ref = target.package_product_dependencies.find { |r| r.class == ref_class && r.package == pkg && r.product_name == product_name }
  if !ref
    ref = project.new(ref_class)
    ref.package = pkg
    ref.product_name = product_name
    target.package_product_dependencies << ref
  end
end

def $TrailheadTileServer.post_install(installer)
  pods_project = installer.pods_project
  pod_target = pods_project.targets.find { |t| t.name == 'TileServer' }

  pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '16.4'
    end
  end

  $TrailheadTileServer_SPM_SPECS.each do |spm_spec|
    self._add_spm_to_target(
      pods_project,
      pod_target,
      spm_spec[:url],
      spm_spec[:requirement],
      spm_spec[:product_name]
    )
  end

  installer.aggregate_targets.group_by(&:user_project).each do |project, targets|
    targets.each do |target|
      target.user_targets.each do |user_target|
        $TrailheadTileServer_SPM_SPECS.each do |spm_spec|
          self._add_spm_to_target(
            project,
            user_target,
            spm_spec[:url],
            spm_spec[:requirement],
            spm_spec[:product_name]
          )
        end
      end
    end
  end
end

Pod::Spec.new do |s|
  s.name           = 'TileServer'
  s.version        = package['version']
  s.summary        = 'Local PMTiles HTTP tile server for offline maps'
  s.homepage       = 'https://trailhead.app'
  s.license        = 'MIT'
  s.author         = { 'Trailhead' => '' }
  s.platforms      = { :ios => '16.4' }
  s.source         = { :path => '.' }
  s.source_files   = 'ios/**/*.{swift,m,h}'
  s.libraries      = 'z'
  s.dependency 'ExpoModulesCore'
end
