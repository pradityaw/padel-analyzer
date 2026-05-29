#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const xcode = require("xcode");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const mobileRoot = path.resolve(__dirname, "..");
const iosRoot = path.join(mobileRoot, "ios");
const templateRoot = path.join(mobileRoot, "ios-native-tests");

const appConfig = JSON.parse(
  fs.readFileSync(path.join(mobileRoot, "app.json"), "utf8")
);

const bundleId =
  appConfig?.expo?.ios?.bundleIdentifier ?? "com.example.padelanalyzermobile";

function fail(message) {
  console.error(`[ios:setup-tests] ${message}`);
  process.exit(1);
}

function unquote(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value.replace(/^"(.*)"$/, "$1");
}

function discoverXcodeProject() {
  if (!fs.existsSync(iosRoot)) {
    fail("Missing ios/ directory. Run `npm run ios:prebuild` first.");
  }

  const xcodeprojName = fs
    .readdirSync(iosRoot, { withFileTypes: true })
    .find((entry) => entry.isDirectory() && entry.name.endsWith(".xcodeproj"))
    ?.name;

  if (!xcodeprojName) {
    fail("Could not find an .xcodeproj in ios/.");
  }

  const projectName = xcodeprojName.replace(/\.xcodeproj$/, "");
  const pbxprojPath = path.join(iosRoot, xcodeprojName, "project.pbxproj");
  const schemePath = path.join(
    iosRoot,
    xcodeprojName,
    "xcshareddata",
    "xcschemes",
    `${projectName}.xcscheme`
  );

  return { projectName, pbxprojPath, schemePath };
}

function renderTemplate(templateName, replacements) {
  const source = fs.readFileSync(path.join(templateRoot, templateName), "utf8");
  return source.replace(/__([A-Z0-9_]+)__/g, (_, token) => {
    if (!(token in replacements)) {
      throw new Error(`Missing replacement value for token: ${token}`);
    }

    return replacements[token];
  });
}

function writeTemplateFile(relativePath, templateName, replacements) {
  const absolutePath = path.join(iosRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(
    absolutePath,
    renderTemplate(templateName, replacements),
    "utf8"
  );
}

function findTargetByName(project, targetName) {
  const nativeTargets = project.pbxNativeTargetSection();
  for (const [uuid, target] of Object.entries(nativeTargets)) {
    if (uuid.endsWith("_comment") || !target?.name) {
      continue;
    }

    if (unquote(target.name) === targetName) {
      return { uuid, target };
    }
  }

  return null;
}

function findAppTarget(project, preferredName) {
  const nativeTargets = project.pbxNativeTargetSection();
  let firstAppTarget = null;

  for (const [uuid, target] of Object.entries(nativeTargets)) {
    if (uuid.endsWith("_comment")) {
      continue;
    }

    if (target?.productType !== '"com.apple.product-type.application"') {
      continue;
    }

    const name = unquote(target.name);
    if (name === preferredName) {
      return { uuid, target };
    }

    if (!firstAppTarget) {
      firstAppTarget = { uuid, target };
    }
  }

  return firstAppTarget;
}

function ensureGroup(project, parentGroupKey, name, groupPath) {
  let groupKey = project.findPBXGroupKey({ name });
  if (!groupKey) {
    groupKey = project.pbxCreateGroup(name, groupPath);
    project.addToPbxGroup(groupKey, parentGroupKey);
  }
  return groupKey;
}

function ensureSourcesAndFrameworkPhases(project, targetUuid) {
  const target = project.pbxNativeTargetSection()[targetUuid];
  const buildPhases = target.buildPhases ?? [];
  const phaseSection = project.hash.project.objects;

  const hasSources = buildPhases.some((phaseRef) => {
    const phase = phaseSection.PBXSourcesBuildPhase?.[phaseRef.value];
    return Boolean(phase);
  });
  const hasFrameworks = buildPhases.some((phaseRef) => {
    const phase = phaseSection.PBXFrameworksBuildPhase?.[phaseRef.value];
    return Boolean(phase);
  });

  if (!hasSources) {
    project.addBuildPhase([], "PBXSourcesBuildPhase", "Sources", targetUuid);
  }
  if (!hasFrameworks) {
    project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", targetUuid);
  }
}

function updateTargetBuildSettings(project, targetUuid, mutateSettings) {
  const nativeTarget = project.pbxNativeTargetSection()[targetUuid];
  const configListUuid = nativeTarget.buildConfigurationList;
  const configList = project.pbxXCConfigurationList()[configListUuid];

  for (const configRef of configList.buildConfigurations ?? []) {
    const config = project.pbxXCBuildConfigurationSection()[configRef.value];
    mutateSettings(config.buildSettings, config.name);
  }
}

function getTargetDeploymentTarget(project, targetUuid) {
  const nativeTarget = project.pbxNativeTargetSection()[targetUuid];
  const configListUuid = nativeTarget.buildConfigurationList;
  const configList = project.pbxXCConfigurationList()[configListUuid];

  for (const configRef of configList.buildConfigurations ?? []) {
    const config = project.pbxXCBuildConfigurationSection()[configRef.value];
    const deploymentTarget = config?.buildSettings?.IPHONEOS_DEPLOYMENT_TARGET;
    if (deploymentTarget) {
      return unquote(deploymentTarget);
    }
  }

  return "15.1";
}

function removeDependencyIfPresent(project, fromTargetUuid, toTargetUuids) {
  const toTargetUuidSet = new Set(toTargetUuids);
  const objects = project.hash.project.objects;
  const nativeTarget = objects.PBXNativeTarget[fromTargetUuid];
  const dependencySection = objects.PBXTargetDependency ?? {};
  const proxySection = objects.PBXContainerItemProxy ?? {};

  nativeTarget.dependencies = (nativeTarget.dependencies ?? []).filter((ref) => {
    const dependency = dependencySection[ref.value];
    const proxy = dependency?.targetProxy
      ? proxySection[dependency.targetProxy]
      : null;
    const remoteTargetUuid = proxy?.remoteGlobalIDString;
    const shouldRemove = remoteTargetUuid && toTargetUuidSet.has(remoteTargetUuid);

    if (shouldRemove) {
      delete dependencySection[ref.value];
      delete dependencySection[`${ref.value}_comment`];
      if (dependency.targetProxy) {
        delete proxySection[dependency.targetProxy];
        delete proxySection[`${dependency.targetProxy}_comment`];
      }
    }

    return !shouldRemove;
  });
}

function hasDependency(project, fromTargetUuid, toTargetUuid) {
  const objects = project.hash.project.objects;
  const target = objects.PBXNativeTarget[fromTargetUuid];
  const dependencySection = objects.PBXTargetDependency ?? {};
  const proxySection = objects.PBXContainerItemProxy ?? {};

  return (target.dependencies ?? []).some((ref) => {
    const dependency = dependencySection[ref.value];
    const proxy = dependency?.targetProxy
      ? proxySection[dependency.targetProxy]
      : null;
    return proxy?.remoteGlobalIDString === toTargetUuid;
  });
}

function fixNestedTestFilePaths(project, targetName) {
  const fileSection = project.pbxFileReferenceSection();
  for (const [uuid, fileRef] of Object.entries(fileSection)) {
    if (uuid.endsWith("_comment") || !fileRef?.path) {
      continue;
    }

    const path = unquote(fileRef.path);
    if (path === `${targetName}/${targetName}.swift`) {
      fileRef.path = `"${targetName}.swift"`;
    }
    if (path === `${targetName}/${targetName}-Info.plist`) {
      fileRef.path = `"${targetName}-Info.plist"`;
    }
  }
}

function ensureSchemeTestables(schemePath, projectName, testTargets) {
  if (!fs.existsSync(schemePath)) {
    fail(`Missing scheme at ${schemePath}.`);
  }

  const renderedReferences = testTargets
    .map(
      (target) => `         <TestableReference
            skipped = "NO">
            <BuildableReference
               BuildableIdentifier = "primary"
               BlueprintIdentifier = "${target.uuid}"
               BuildableName = "${target.name}.xctest"
               BlueprintName = "${target.name}"
               ReferencedContainer = "container:${projectName}.xcodeproj">
            </BuildableReference>
         </TestableReference>`
    )
    .join("\n");

  const testablesBlock = `      <Testables>
${renderedReferences}
      </Testables>`;

  let schemeXml = fs.readFileSync(schemePath, "utf8");

  if (schemeXml.includes("<Testables>")) {
    schemeXml = schemeXml.replace(/<Testables>[\s\S]*?<\/Testables>/, testablesBlock);
  } else {
    schemeXml = schemeXml.replace("</TestAction>", `${testablesBlock}\n   </TestAction>`);
  }

  fs.writeFileSync(schemePath, schemeXml, "utf8");
}

function ensureIosTestTargets() {
  const { projectName, pbxprojPath, schemePath } = discoverXcodeProject();

  const unitTargetName = `${projectName}Tests`;
  const uiTargetName = `${projectName}UITests`;

  const replacementTokens = {
    APP_TARGET_NAME: projectName,
    BUNDLE_IDENTIFIER: bundleId,
    UNIT_TARGET_NAME: unitTargetName,
    UI_TARGET_NAME: uiTargetName,
  };

  writeTemplateFile(
    `${unitTargetName}/${unitTargetName}.swift`,
    "UnitSmokeTest.swift.template",
    replacementTokens
  );
  writeTemplateFile(
    `${unitTargetName}/${unitTargetName}-Info.plist`,
    "UnitInfo.plist.template",
    replacementTokens
  );
  writeTemplateFile(
    `${uiTargetName}/${uiTargetName}.swift`,
    "UISmokeTest.swift.template",
    replacementTokens
  );
  writeTemplateFile(
    `${uiTargetName}/${uiTargetName}-Info.plist`,
    "UIInfo.plist.template",
    replacementTokens
  );

  const project = xcode.project(pbxprojPath);
  project.parseSync();

  const appTarget = findAppTarget(project, projectName);
  if (!appTarget) {
    fail("Could not find application target in project.pbxproj.");
  }

  const deploymentTarget = getTargetDeploymentTarget(project, appTarget.uuid);
  const mainGroupKey = project.getFirstProject().firstProject.mainGroup;
  const unitGroupKey = ensureGroup(
    project,
    mainGroupKey,
    unitTargetName,
    unitTargetName
  );
  const uiGroupKey = ensureGroup(project, mainGroupKey, uiTargetName, uiTargetName);

  let unitTarget = findTargetByName(project, unitTargetName);
  if (!unitTarget) {
    const created = project.addTarget(
      unitTargetName,
      "unit_test_bundle",
      unitTargetName,
      `${bundleId}.tests`
    );
    unitTarget = { uuid: created.uuid, target: created.pbxNativeTarget };
  }

  let uiTarget = findTargetByName(project, uiTargetName);
  if (!uiTarget) {
    const created = project.addTarget(
      uiTargetName,
      "unit_test_bundle",
      uiTargetName,
      `${bundleId}.uitests`
    );
    uiTarget = { uuid: created.uuid, target: created.pbxNativeTarget };
  }

  project.pbxNativeTargetSection()[uiTarget.uuid].productType =
    '"com.apple.product-type.bundle.ui-testing"';

  removeDependencyIfPresent(project, appTarget.uuid, [unitTarget.uuid, uiTarget.uuid]);
  if (!hasDependency(project, uiTarget.uuid, appTarget.uuid)) {
    project.addTargetDependency(uiTarget.uuid, [appTarget.uuid]);
  }

  ensureSourcesAndFrameworkPhases(project, unitTarget.uuid);
  ensureSourcesAndFrameworkPhases(project, uiTarget.uuid);

  updateTargetBuildSettings(project, unitTarget.uuid, (settings) => {
    settings.INFOPLIST_FILE = `${unitTargetName}/${unitTargetName}-Info.plist`;
    settings.PRODUCT_BUNDLE_IDENTIFIER = `${bundleId}.tests`;
    settings.PRODUCT_NAME = unitTargetName;
    settings.IPHONEOS_DEPLOYMENT_TARGET = deploymentTarget;
    settings.SWIFT_VERSION = "5.0";
    settings.CODE_SIGNING_ALLOWED = "NO";
    settings.CODE_SIGNING_REQUIRED = "NO";
    settings.GENERATE_INFOPLIST_FILE = "NO";
  });

  updateTargetBuildSettings(project, uiTarget.uuid, (settings) => {
    settings.INFOPLIST_FILE = `${uiTargetName}/${uiTargetName}-Info.plist`;
    settings.PRODUCT_BUNDLE_IDENTIFIER = `${bundleId}.uitests`;
    settings.PRODUCT_NAME = uiTargetName;
    settings.IPHONEOS_DEPLOYMENT_TARGET = deploymentTarget;
    settings.SWIFT_VERSION = "5.0";
    settings.CODE_SIGNING_ALLOWED = "NO";
    settings.CODE_SIGNING_REQUIRED = "NO";
    settings.GENERATE_INFOPLIST_FILE = "NO";
    settings.TEST_TARGET_NAME = projectName;
  });

  project.addSourceFile(
    `${unitTargetName}.swift`,
    { target: unitTarget.uuid },
    unitGroupKey
  );
  project.addFile(`${unitTargetName}-Info.plist`, unitGroupKey);

  project.addSourceFile(
    `${uiTargetName}.swift`,
    { target: uiTarget.uuid },
    uiGroupKey
  );
  project.addFile(`${uiTargetName}-Info.plist`, uiGroupKey);

  fixNestedTestFilePaths(project, unitTargetName);
  fixNestedTestFilePaths(project, uiTargetName);

  fs.writeFileSync(pbxprojPath, project.writeSync(), "utf8");
  ensureSchemeTestables(schemePath, projectName, [
    { uuid: unitTarget.uuid, name: unitTargetName },
    { uuid: uiTarget.uuid, name: uiTargetName },
  ]);

  console.log(
    `[ios:setup-tests] Added/updated native test targets: ${unitTargetName}, ${uiTargetName}`
  );
}

ensureIosTestTargets();
