const core = require("@actions/core");
const github = require("@actions/github");
const {
  ECRClient,
  GetAuthorizationTokenCommand,
} = require("@aws-sdk/client-ecr");

const fs = require("fs").promises;

const lib = require("./lib");

function reRegisterHelperTxt(ghRepo, ghBranch) {
  return `
  Please re-register this github repository to get updated credentials:
  
  glgroup ecr register-github-repo -r ${ghRepo} -b ${ghBranch}
  `;
}

/**
 * The main workflow
 */
async function main() {
  const inputs = lib.getInputs();
  let buildxEnabled = false;

  /**
   * Versions
   */
  core.startGroup("docker version");
  const { stdout: dockerVersion } = await lib.util.execFile("docker", [
    "version",
  ]);
  console.log(dockerVersion);
  core.endGroup();

  core.startGroup("docker buildx version");
  try {
    const { stdout: buildxVersion } = await lib.util.execFile("docker", [
      "buildx",
      "version",
    ]);
    console.log(buildxVersion);
    core.setOutput("buildx", "enabled");
    buildxEnabled = true;
  } catch (e) {
    console.log(`builx unavailable - ${e.message}`);
  }
  core.endGroup();

  core.startGroup("docker info");
  const { stdout: dockerInfo } = await lib.util.execFile("docker", ["info"]);
  console.log(dockerInfo);
  core.endGroup();

  /**
   * Ensure dockerfile exists and can be read
   */
  let dockerfile;
  try {
    dockerfile = await fs.readFile(inputs.dockerfile, "utf8");
  } catch (e) {
    core.error(e);
    process.exit(2);
  }

  /**
   * Check for buildx flags when buildx is not enabled
   */
  if (!buildxEnabled && inputs.platform) {
    core.error(
      "platform requested while buildx is not enabled. Please check your configuration and try again."
    );
    process.exit(3);
  }

  const {
    ref,
    sha,
    payload: {
      repository: {
        full_name: ghRepo,
        name: repoName,
        default_branch: defaultBranch,
      },
    },
  } = github.context;

  const branch = ref.split("refs/heads/")[1];
  const ecrRepository = `github/${ghRepo}/${branch}`.toLowerCase();
  const containerBase = `${inputs.ecrURI}/${ecrRepository}`.toLowerCase();
  const prefix = inputs.architecture ? `${inputs.architecture}-` : "";
  const containerImageLatest = `${containerBase}:${prefix}latest`;
  const containerImageSha = `${containerBase}:${prefix}${sha}`;

  const dockerBuildArgs = [
    "--tag",
    containerImageLatest,
    "--tag",
    containerImageSha,
  ];
  const sshAuthSock = "/tmp/ssh_agent.sock";

  // Only include the GITHUB_SSH_KEY if it exists
  if (inputs.githubSSHKey) {
    /**
     * If the dockerfile requests buildkit functionality,
     * appease it, otherwise default to build args
     */
    if (/mount=type=ssh/.test(dockerfile)) {
      await lib.util.execFile("ssh-agent", ["-a", sshAuthSock]);
      const key = Buffer.from(inputs.githubSSHKey, "base64").toString("utf8");
      const keyFileName = "key";
      await fs.writeFile(keyFileName, key);
      await lib.util.execFile("ssh-add", [keyFileName]);
    } else {
      dockerBuildArgs.push(
        "--build-arg",
        `GITHUB_SSH_KEY=${inputs.githubSSHKey}`
      );
    }
  }

  // Only include the GITHUB_SHA if it is used
  if (/GITHUB_SHA/.test(dockerfile)) {
    dockerBuildArgs.push("--build-arg", `GITHUB_SHA=${sha}`);
  }

  if (inputs.dockerfile && inputs.dockerfile !== "Dockerfile") {
    dockerBuildArgs.push("-f", inputs.dockerfile);
  }

  if (inputs.buildConfig) {
    dockerBuildArgs.push("--build-arg", `BUILD_CONFIG=${inputs.buildConfig}`);
  }

  if (buildxEnabled && inputs.platform) {
    dockerBuildArgs.push("--platform", inputs.platform, "--load");
  }

  const buildEnv = {};
  if (/^\s*run\s?<</i.test(dockerfile)) {
    buildEnv["DOCKER_BUILDKIT"] = 1;
    buildEnv["BUILDKIT_PROGRESS"] = "plain";
  }

  // aws_account_id.dkr.ecr.region.amazonaws.com
  const region = inputs.ecrURI.split(".")[3];
  const ecrClient = new ECRClient({
    region,
    credentials: {
      accessKeyId: inputs.accessKeyId,
      secretAccessKey: inputs.secretAccessKey,
    },
  });

  /**
   * Ensure ECR Repository Exists
   */
  try {
    await lib.assertECRRepo(ecrClient, ecrRepository);
  } catch (e) {
    core.error(e.message + reRegisterHelperTxt(repoName, defaultBranch));
    process.exit(1);
  }

  const hosts = [inputs.ecrURI];

  /**
   * Log in to Docker
   */
  const { dockerBuildArgs: moreArgs, hosts: moreHosts } =
    await lib.loginToAllRegistries(ecrClient, inputs);
  dockerBuildArgs.push(...moreArgs);
  hosts.push(...moreHosts);

  /**
   * Parse any additional build args
   */
  if (inputs.buildArgs) {
    inputs.buildArgs
      .split("\n")
      .filter((line) => !!line)
      .forEach((arg) => {
        dockerBuildArgs.push("--build-arg", arg);
      });
  }

  /**
   * Build the image
   */
  core.startGroup("Docker Build");
  await lib.dockerBuild(dockerBuildArgs, buildEnv);
  core.endGroup();

  /**
   * Healthcheck
   */
  if (inputs.healthcheck) {
    await lib.runHealthcheck(containerImageSha, inputs);
  } else {
    core.warning("No healthcheck specified");
  }

  /**
   * Push up all tags
   */
  if (inputs.deploy) {
    await lib.execWithLiveOutput("docker", [
      "push",
      containerBase,
      "--all-tags",
    ]);
  }

  /**
   * Log out of all registries
   */
  await Promise.all(
    hosts.map((host) => lib.execFile("docker", ["logout", host]))
  );
}

main();
