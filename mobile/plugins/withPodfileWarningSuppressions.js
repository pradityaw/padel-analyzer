const { createRunOncePlugin, withPodfile } = require("@expo/config-plugins");

const PLUGIN_NAME = "with-podfile-warning-suppressions";
const PLUGIN_VERSION = "1.0.0";

const BEGIN_MARKER = "# >>> pod-warning-suppressions (generated)";
const END_MARKER = "# <<< pod-warning-suppressions (generated)";

const RUBY_SNIPPET = `${BEGIN_MARKER}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_config|
        # Silence warning noise from third-party pods only.
        # The app target lives in a separate project and remains unaffected.
        build_config.build_settings['GCC_WARN_INHIBIT_ALL_WARNINGS'] = 'YES'
        build_config.build_settings['SWIFT_SUPPRESS_WARNINGS'] = 'YES'

        existing_flags = build_config.build_settings['OTHER_CFLAGS'] || '$(inherited)'
        existing_flags = [existing_flags] unless existing_flags.is_a?(Array)
        unless existing_flags.include?('-Wno-nonportable-include-path')
          existing_flags << '-Wno-nonportable-include-path'
        end
        build_config.build_settings['OTHER_CFLAGS'] = existing_flags
      end
    end
${END_MARKER}`;

function withPodfileWarningSuppressions(config) {
  return withPodfile(config, (modConfig) => {
    const contents = modConfig.modResults.contents;
    const existingRegex = new RegExp(`${BEGIN_MARKER}[\\s\\S]*?${END_MARKER}\\n?`, "m");

    if (existingRegex.test(contents)) {
      modConfig.modResults.contents = contents.replace(existingRegex, `${RUBY_SNIPPET}\n`);
      return modConfig;
    }

    const postInstallRegex = /(post_install do \|installer\|[\s\S]*?react_native_post_install\([\s\S]*?\n\s*end\n)/m;
    if (!postInstallRegex.test(contents)) {
      throw new Error("Could not find post_install block in Podfile.");
    }

    modConfig.modResults.contents = contents.replace(postInstallRegex, (match) => {
      return match.replace(/\n\s*end\n$/, `\n${RUBY_SNIPPET}\n  end\n`);
    });

    return modConfig;
  });
}

module.exports = createRunOncePlugin(
  withPodfileWarningSuppressions,
  PLUGIN_NAME,
  PLUGIN_VERSION
);
