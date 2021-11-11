const core = require("@actions/core");
const github = require("@actions/github");
const {
  ECRClient,
  DescribeRepositoriesCommand,
  CreateRepositoryCommand,
  SetRepositoryPolicyCommand,
  GetAuthorizationTokenCommand,
} = require("@aws-sdk/client-ecr");

const child_process = require("child_process");
const { promisify } = require("util");
const fs = require("fs").promises;

const ecrPolicy = require("./ecr-policy.json");

const execFile = promisify(child_process.execFile);

function getInputs() {
  const accessKeyId = core.getInput("access_key_id", { required: true });
  const secretAccessKey = core.getInput("secret_access_key", {
    required: true,
  });
  const ecrURI = core.getInput("ecr_uri", { required: true });
  const architecture = core.getInput("architecture");
  const buildArgs = core.getInput("build-args");
  const buildConfig = core.getInput("build_config");
  const deploy = core.getBooleanInput("deploy");
  const dockerfile = core.getInput("dockerfile");
  const envFile = core.getInput("env_file");
  const githubSSHKey = core.getInput("github_ssh_key");
  const healthcheck = core.getInput("healthcheck");
  const platform = core.getInput("platform");
  const port = core.getInput("port");
  const registries = core.getInput("registries");
  return {
    accessKeyId,
    secretAccessKey,
    ecrURI,
    architecture,
    buildArgs,
    buildConfig,
    deploy,
    dockerfile,
    envFile,
    githubSSHKey,
    healthcheck,
    platform,
    port,
    registries,
  };
}

async function main() {
  const inputs = getInputs();
  let buildxEnabled = false;

  /**
   * Versions
   */
  core.startGroup("docker version");
  const { stdout: dockerVersion } = await execFile("docker", ["version"]);
  console.log(dockerVersion);
  core.endGroup();

  core.startGroup("docker buildx version");
  try {
    const { stdout: buildxVersion } = await execFile("docker", [
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
  const { stdout: dockerInfo } = await execFile("docker", ["info"]);
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

  const dockerBuildArgs = [];
  const sshAuthSock = "/tmp/ssh_agent.sock";

  // Only include the GITHUB_SSH_KEY if it exists
  if (inputs.githubSSHKey) {
    /**
     * If the dockerfile requests buildkit functionality,
     * appease it, otherwise default to build args
     */
    if (/mount=type=ssh/.test(dockerfile)) {
      await execFile("ssh-agent", ["-a", sshAuthSock]);
      const key = Buffer.from(inputs.githubSSHKey, "base64").toString("utf8");
      const keyFileName = "key";
      await fs.writeFile(keyFileName, key);
      await execFile("ssh-add", [keyFileName]);
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
    await assertECRRepo(ecrClient, ecrRepository);
  } catch (e) {
    core.error(e.message + reRegisterHelperTxt(repoName, defaultBranch));
    process.exit(1);
  }

  const getAuthCmd = new GetAuthorizationTokenCommand();
  try {
    const resp = await ecrClient.send(getAuthCmd);
    console.log(JSON.stringify(resp, null, 2));
  } catch (e) {
    core.error(e);
    core.error("Unable to obtain ECR password");
    process.exit(4);
  }
}

async function assertECRRepo(client, repository) {
  const describeCmd = new DescribeRepositoriesCommand({
    repositoryNames: [repository],
  });

  try {
    await client.send(describeCmd);
  } catch (e) {
    // If it doesn't exist, create it
    if (e.name === "RepositoryNotFoundException") {
      const createCmd = new CreateRepositoryCommand({
        repositoryName: repository,
        tags: [
          {
            Key: "ManagedBy",
            Value: "GitHub",
          },
        ],
      });

      try {
        await client.send(createCmd);
        try {
          const setPolicyCmd = new SetRepositoryPolicyCommand({
            repositoryName: repository,
            policyText: JSON.stringify(ecrPolicy),
          });
          await client.send(setPolicyCmd);
        } catch (eee) {
          const err = new Error(`Could not set ECR policy for ${repository}`);
          err.name = "CouldNotSetPolicy";
          err.repository = repository;
          throw err;
        }
      } catch (ee) {
        const err = new Error(`Could not create ECR Repository: ${repository}`);
        err.name = "CouldNotCreateRepo";
        err.repository = repository;
        throw err;
      }
    } else throw e;
  }
}

function reRegisterHelperTxt(ghRepo, ghBranch) {
  return `
  Please re-register this github repository to get updated credentials:
  
  glgroup ecr register-github-repo -r ${ghRepo} -b ${ghBranch}
  `;
}

main();
