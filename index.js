const core = require("@actions/core");

function getInputs() {
  const accessKeyId = core.getInput("access_key_id", { required: true });
  const secretAccessKey = core.getInput("secretAccessKey", { required: true });
  const ecrURI = core.getInput("ecr_uri", { required: true });
  const architecture = core.getInput("architecture");
  const buildArgs = core.getInput("build-args");
  const build_config = core.getInput("build_config");
  const deploy = core.getBooleanInput("deploy");
  const dockerfile = core.getInput("dockerfile");
  const env_file = core.getInput("env_file");
  const github_ssh_key = core.getInput("github_ssh_key");
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
    build_config,
    deploy,
    dockerfile,
    env_file,
    github_ssh_key,
    healthcheck,
    platform,
    port,
    registries,
  };
}
