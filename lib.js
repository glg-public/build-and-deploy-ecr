const core = require("@actions/core");
const github = require("@actions/github");
const http = require("http");
const child_process = require("child_process");
const { promisify } = require("util");
const ecrPolicy = require("./ecr-policy.json");
const {
  DescribeRepositoriesCommand,
  CreateRepositoryCommand,
  SetRepositoryPolicyCommand,
  GetAuthorizationTokenCommand,
  ECRClient,
} = require("@aws-sdk/client-ecr");

const fs = require("fs").promises;

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
  const unitTest = core.getInput("unit_test");
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
    unitTest,
    healthcheck,
    platform,
    port,
    registries,
  };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// No need to pull in axios just  for this
function httpGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    let data = "";
    http
      .get(url, options, (resp) => {
        // A chunk of data has been received.
        resp.on("data", (chunk) => {
          data += chunk;
        });

        // The whole response has been received. Parse it and resolve the promise
        resp.on("end", () => {
          try {
            const retValue = data;
            if (resp.statusCode >= 400) {
              reject({ data: retValue, statusCode: resp.statusCode });
            } else {
              resolve({ data: retValue, statusCode: resp.statusCode });
            }
          } catch (error) {
            reject({ data, error, statusCode: resp.statusCode });
          }
        });
      })
      .on("error", (error) => {
        reject({ data, error });
      });
  });
}

const execFile = promisify(child_process.execFile);

function execWithLiveOutput(command, args, env) {
  return new Promise((resolve, reject) => {
    const cmd = child_process.spawn(command, args, { env });
    cmd.stdout.on("data", (data) => {
      console.log(data.toString());
    });
    cmd.stderr.on("data", (data) => {
      console.error(data.toString());
    });
    cmd.on("exit", (code) => {
      if (code === 0) {
        return resolve();
      } else {
        return reject(code);
      }
    });
  });
}

const util = {
  httpGet,
  execFile,
  execWithLiveOutput,
  sleep,
  dockerLogin,
  assertECRRepo,
  dockerBuild,
  runUnitTest,
  runHealthcheck,
  loginToAllRegistries,
  getInputs,
};

async function runUnitTest(imageName, inputs) {
  const args = ["run", "--name", "test-container"]
  
  if (inputs.envFile) {
    args.push("--env-file", inputs.envFile)
  }

  const timeout = ms => {
    let timer
    const promise = new Promise(async (resolve, reject) => {
      async function writeLogs() {
        core.startGroup("docker logs")
        const { stdout: dockerLogsStdout, stderr: dockerLogsStderr } = await util.execFile("docker", [
          "logs",
          "test-container"
        ])
        console.log(dockerLogsStdout)
        console.log(dockerLogsStderr)
        const { stdout } = await util.execFile("docker", ["stop", "test-container"])
        
        console.log(`${stdout} stopped.`)
        core.endGroup()
        resolve()
      }

      timer = setTimeout(() => {
        core.error("Container did not pass tests after 30 minutes")
        writeLogs().catch(reject)
      }, ms) // timeout if tests didn't complete in 30 minutes
    })
    
    return { promise, cancel: () => clearTimeout(timer) }
  }

  const timeoutObj = timeout(1000 * 60 * 60 * 30)
  timeoutObj.promise
    .then(() => {
      process.exit(1)
    })
    .catch(() => {
      process.exit(1)
    })

  const { stdout: dockerRunStdout, stderr: dockerRunStderr } = await util.execFile("docker", [
    ...args,
    imageName,
    ...inputs.unitTest.match(/"[^"]+"|'[^']+'|\S+/g)
  ])
  timeoutObj.cancel()
  console.log(dockerRunStdout)
  console.log(dockerRunStderr)

  if (!dockerRunStdout || dockerRunStderr) process.exit(1)

  console.log("unit test passed")
}

async function runHealthcheck(imageName, inputs) {
  const args = [
    "run",
    "--detach",
    "--net",
    "host",
    "--publish",
    `${inputs.port}:${inputs.port}`,
    "--env",
    `HEALTHCHECK=${inputs.healthcheck}`,
    "--env",
    `PORT=${inputs.port}`,
    "--name",
    "test-container",
  ];

  if (inputs.envFile) {
    args.push("--env-file", inputs.envFile);
  }

  const { stdout: dockerRunStdout } = await util.execFile("docker", [
    ...args,
    imageName,
  ]);
  console.log(dockerRunStdout);

  let attemptCount = 0;
  const maxAttempts = 5;
  const healthcheckURL = `http://localhost:${inputs.port}${inputs.healthcheck}`;
  while (attemptCount < maxAttempts) {
    attemptCount += 1;
    try {
      await util.httpGet(healthcheckURL);
      break;
    } catch (e) {
      console.log(
        `Tested Healthcheck ${healthcheckURL} : Attempt ${attemptCount} of ${maxAttempts}`
      );
      await util.sleep(5000);
    }
  }
  if (attemptCount >= maxAttempts) {
    core.error(
      `Container did not pass healthcheck at ${healthcheckURL} after ${maxAttempts} attempts`
    );
    core.warning(
      "If your container does not require a healthcheck (most jobs don't), then set healthcheck to a blank string."
    );
    core.startGroup("docker logs");
    const { stdout: dockerLogsStdout, stderr: dockerLogsStderr } =
      await util.execFile("docker", ["logs", "test-container"]);
    console.log(dockerLogsStdout);
    console.log(dockerLogsStderr);
    core.endGroup();
    process.exit(1);
  }

  console.log("Healthcheck Passed!");
  const { stdout } = await util.execFile("docker", ["stop", "test-container"]);
  console.log(`${stdout} stopped.`);
}

function dockerBuild(args, env = {}) {
  return util.execWithLiveOutput("docker", ["build", ...args, "."], env);
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
        if (ee.name !== "CouldNotSetPolicy") {
          const err = new Error(
            `Could not create ECR Repository: ${repository}`
          );
          err.name = "CouldNotCreateRepo";
          err.repository = repository;
          throw err;
        }
        throw ee;
      }
    } else throw e;
  }
}

async function dockerLogin(ecrClient, ecrURI) {
  /**
   * Log in to Docker
   */
  const getAuthCmd = new GetAuthorizationTokenCommand({});
  let ecrUser, ecrPass;
  try {
    const resp = await ecrClient.send(getAuthCmd);
    const ecrAuthToken = resp.authorizationData[0].authorizationToken;
    const [user, pass] = Buffer.from(ecrAuthToken, "base64")
      .toString("utf8")
      .split(":");
    ecrUser = user;
    ecrPass = pass;
  } catch (e) {
    core.error(e);
    core.error("Unable to obtain ECR password");
    return process.exit(4);
  }

  // Mask the token in logs
  core.setSecret(ecrPass);

  await util.execFile("docker", [
    "login",
    "--username",
    ecrUser,
    "--password",
    ecrPass,
    ecrURI,
  ]);
}

async function loginToAllRegistries(ecrClient, inputs, ecrRepository, sha) {
  const dockerBuildArgs = [];
  const hosts = [];
  await util.dockerLogin(ecrClient, inputs.ecrURI);
  if (inputs.registries) {
    // Split on comma if there's a comma, otherwise on newline
    const urls = /,/.test(inputs.registries)
      ? inputs.registries.split(",")
      : inputs.registries.split("\n");
    const awsUrl = /aws:\/\/([^:]+):([^@]+)@([0-9a-zA-Z.-]+)/;
    await Promise.all(
      urls
        .filter((url) => !!url)
        .map(async (url) => {
          const match = awsUrl.exec(url);
          if (match) {
            const [, accessKeyId, secretAccessKey, ecrURI] = match;
            const otherRegion = ecrURI.split(".")[3];
            const otherEcrClient = new ECRClient({
              region: otherRegion,
              credentials: {
                accessKeyId,
                secretAccessKey,
              },
            });

            await util.assertECRRepo(otherEcrClient, ecrRepository);

            await util.dockerLogin(otherEcrClient, ecrURI);

            hosts.push(ecrURI);
            dockerBuildArgs.push(
              "--tag",
              `${ecrURI}/${ecrRepository}:latest`, // Should this be prefixed for other platforms?
              "--tag",
              `${ecrURI}/${ecrRepository}:${sha}` // Should this be prefixed for other platforms?
            );
          } else {
            core.warning(`Bad registries value - ${url}`);
          }
        })
    );
  }
  return { dockerBuildArgs, hosts };
}

function reRegisterHelperTxt(ghRepo) {
  return `
  Please re-register this github repository to get updated credentials:

  glgroup ecr register-github-repo -r ${ghRepo}
  `;
}

/**
 * The main workflow
 */
async function main() {
  const inputs = util.getInputs();
  let buildxEnabled = false;

  /**
   * Versions
   */
  core.startGroup("docker version");
  const { stdout: dockerVersion } = await util.execFile("docker", ["version"]);
  console.log(dockerVersion);
  core.endGroup();

  core.startGroup("docker buildx version");
  try {
    const { stdout: buildxVersion } = await util.execFile("docker", [
      "buildx",
      "version",
    ]);
    console.log(buildxVersion);
    core.setOutput("buildx", "enabled");
    buildxEnabled = true;
  } catch (e) {
    console.log(`buildx unavailable - ${e.message}`);
  }
  core.endGroup();

  core.startGroup("docker info");
  const { stdout: dockerInfo } = await util.execFile("docker", ["info"]);
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
    return process.exit(2);
  }

  /**
   * Check for buildx flags when buildx is not enabled
   */
  if (!buildxEnabled && inputs.platform) {
    core.error(
      "platform requested while buildx is not enabled. Please check your configuration and try again."
    );
    return process.exit(3);
  }

  const {
    ref,
    sha,
    payload: {
      repository: { full_name: ghRepo, name: repoName },
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
  core.startGroup("docker ssh setup");
  if (inputs.githubSSHKey) {
    /**
     * If the dockerfile requests buildkit functionality,
     * appease it, otherwise default to build args
     */
    if (/mount=type=ssh/m.test(dockerfile)) {
      await util.execFile("ssh-agent", ["-a", sshAuthSock]);
      const key = Buffer.from(inputs.githubSSHKey, "base64").toString("utf8");
      const keyFileName = "key";
      await fs.writeFile(keyFileName, key);
      await fs.chmod(keyFileName, "0600");
      await util.execFile("ssh-add", [keyFileName], { env: { "SSH_AUTH_SOCK": sshAuthSock }});
      dockerBuildArgs.push(
        "--ssh",
        "default"
      );
    } else {
      dockerBuildArgs.push(
        "--build-arg",
        `GITHUB_SSH_KEY=${inputs.githubSSHKey}`
      );
    }
  }
  core.endGroup();

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

  core.startGroup("docker build env");
  const buildEnv = {};
  if (/^\s*(run|copy).*?<</im.test(dockerfile)) {
    core.info("Enabling Docker Buildkit");
    buildEnv["DOCKER_BUILDKIT"] = 1;
    buildEnv["BUILDKIT_PROGRESS"] = "plain";
  }
  if (/mount=type=ssh/m.test(dockerfile)) {
    buildEnv["SSH_AUTH_SOCK"] = sshAuthSock;
  }
  console.log(buildEnv);
  core.endGroup();

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
    await util.assertECRRepo(ecrClient, ecrRepository);
  } catch (e) {
    core.error(e.message + reRegisterHelperTxt(repoName));
    return process.exit(1);
  }

  const hosts = [inputs.ecrURI];

  /**
   * Log in to Docker
   */
  const { dockerBuildArgs: moreArgs, hosts: moreHosts } =
    await util.loginToAllRegistries(ecrClient, inputs, ecrRepository, sha);
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
  await util.dockerBuild(dockerBuildArgs, buildEnv);
  core.endGroup();

  /**
   * Run Unit Tests
   */
  if (inputs.unitTest) {
    await util.runUnitTest(containerImageSha, inputs)
  } else {
    core.warning("Not running unit tests")
  }

  /**
   * Healthcheck
   */
  if (inputs.healthcheck) {
    await util.runHealthcheck(containerImageSha, inputs);
  } else {
    core.warning("No healthcheck specified");
  }

  /**
   * Push up all tags
   */
  if (inputs.deploy) {
    await util.execWithLiveOutput("docker", [
      "push",
      containerBase,
      "--all-tags",
    ]);
  }

  /**
   * Log out of all registries
   */
  await Promise.all(
    hosts.map((host) => util.execFile("docker", ["logout", host]))
  );
}

module.exports = {
  main,
  util,
  runUnitTest,
  runHealthcheck,
  dockerBuild,
  assertECRRepo,
  loginToAllRegistries,
};
