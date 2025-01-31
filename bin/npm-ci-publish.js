import { publish } from '../src/publish';
import { publishScoped } from '../src/publish-scoped';
import {
  logBlockOpen,
  logBlockClose,
  execCommandAsync,
  readJsonFile,
  writeJsonFile,
} from '../src/utils';
import { writeFileSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';

const program = require('commander');

// eslint-disable-next-line
program.version(require('../../package').version)
  .usage('[publish-type]')
  .parse(process.argv);

const requestedPublishType = program.args[0];

function latest(registry) {
  try {
    const result = JSON.parse(
      execSync(
        `npm show --json --registry=${registry} --@wix:registry=${registry}`,
        { stdio: 'pipe' },
      ).toString(),
    );
    return result['dist-tags'].latest;
  } catch (error) {
    return null;
  }
}

/**
 * @param {import("../src/publish").PublishType} [publishType] The type of publish to perform
 */
async function runPublish(publishType) {
  logBlockOpen('npm publish');
  await publish(undefined, publishType);
  logBlockClose('npm publish');

  if (process.env.PUBLISH_SCOPED) {
    logBlockOpen('npm publish to wix scope');
    await publishScoped(publishType);
    logBlockClose('npm publish to wix scope');
  }
}

let pkg = readJsonFile('package.json');
const previousVersion = pkg.version;
let shouldUnlink = false;
if (pkg.name.indexOf('@wix/') === 0) {
  pkg.publishConfig = { registry: 'https://registry.npmjs.org/' };
  writeJsonFile('package.json', pkg);
  if (
    latest('http://npm.dev.wixpress.com/') !==
    latest('https://registry.npmjs.org/')
  ) {
    console.log('forcing npmjs to trust latest from npmjs');
    writeFileSync('.npmrc', '@wix:registry=https://registry.npmjs.org/'); //trust latest from npmjs
    shouldUnlink = true;
  }
}

execCommandAsync('npm run release --if-present').then(({ stdio }) => {
  if (shouldUnlink) {
    unlinkSync('.npmrc');
  }
  pkg = readJsonFile('package.json');
  if (
    pkg.scripts &&
    pkg.scripts.release &&
    pkg.scripts.release.indexOf('mltci') > -1
  ) {
    console.log(
      'Detected release mltci, it might publish, so skipping publishing myself',
    );
  } else if (pkg.private && previousVersion !== pkg.version) {
    console.log('forcing republish in order to sync versions');
    delete pkg.private;
    writeJsonFile('package.json', pkg);
  }

  // eslint-disable-next-line no-div-regex
  const npmPublishRegex = /[\s\S]*?npm publish[\s\S]*?=== Tarball Details ===[\s\\n]+.*name:\s+([^\s]+)[\s\\n]*.*version:\s+([^\s]+)/gm;
  const stdoutString = stdio.stdout.toString();
  let stdOutMatch;
  let skipPublish = false;
  while ((stdOutMatch = npmPublishRegex.exec(stdoutString))) {
    // eslint-disable-line no-cond-assign
    const [_, pkgName, pkgVersion] = stdOutMatch;
    console.log(
      `Seems like 'release' command published a package ${pkgName} ${pkgVersion}`,
    );
    skipPublish = true;
  }

  if (pkg.private || skipPublish) {
    skipPublish &&
      console.log('Skipping publish because release published something');
    console.log('Skipping publish (probably no change in tarball)');
    console.log(
      `##teamcity[buildStatus status='SUCCESS' text='{build.status.text}; No publish']`,
    );
  } else {
    runPublish(requestedPublishType);
  }
});
