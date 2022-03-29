const sinon = require("sinon");
const lib = require("../lib");
const core = require("@actions/core");
const github = require("@actions/github");
const fs = require("fs").promises;
const { ECRClient } = require("@aws-sdk/client-ecr");

const sandbox = sinon.createSandbox();

let inputStub,
  execStub,
  logStub,
  outputStub,
  exitStub,
  assertRepoStub,
  loginAllStub,
  buildStub,
  healthcheckStub,
  execLiveStub,
  writeFileStub;
const version = "Client:\n  Version: 20.10.2";
const buildxVersion = "something about buildx version";
const context = require("./fixtures/context.json");
const ecrRepository = `github/${context.payload.repository.full_name}/testing-new-build-action`;
const { expect } = require("chai");
describe("Main Workflow", () => {
  beforeEach(() => {
    sandbox.restore();
    inputStub = sandbox.stub(lib.util, "getInputs");

    execStub = sandbox.stub(lib.util, "execFile");
    execStub.resolves({ stdout: "hello world" });
    execStub.withArgs("docker", ["version"]).resolves({ stdout: version });
    execStub
      .withArgs("docker", ["buildx", "version"])
      .resolves({ stdout: buildxVersion });

    exitStub = sandbox.stub(process, "exit");
    outputStub = sandbox.stub(core, "setOutput");

    assertRepoStub = sandbox.stub(lib.util, "assertECRRepo").resolves();
    loginAllStub = sandbox
      .stub(lib.util, "loginToAllRegistries")
      .resolves({ dockerBuildArgs: [], hosts: [] });
    buildStub = sandbox.stub(lib.util, "dockerBuild").resolves();
    healthcheckStub = sandbox.stub(lib.util, "runHealthcheck").resolves();
    execLiveStub = sandbox.stub(lib.util, "execWithLiveOutput").resolves();
    writeFileStub = sandbox.stub(fs, "writeFile").resolves();

    sandbox.stub(github, "context").value(context);

    // Comment this out when debugging tests
    logStub = sandbox.stub(console, "log");
    sandbox.stub(core, "error");
    sandbox.stub(core, "startGroup");
    sandbox.stub(core, "endGroup");
    sandbox.stub(core, "warning");
  });

  after(() => {
    sandbox.restore();
  });

  it("outputs the docker version", async () => {
    // Short circuit by not having a dockerfile
    sandbox.stub(fs, "readFile").rejects();
    await lib.main();

    expect(logStub.firstCall.args[0]).to.equal(version);
  });

  it("checks for docker buildx and sets an output if available", async () => {
    // Short circuit by not having a dockerfile
    sandbox.stub(fs, "readFile").rejects();
    await lib.main();

    expect(logStub.secondCall.args[0]).to.equal(buildxVersion);
    expect(outputStub.callCount).to.equal(1);
    expect(outputStub.firstCall.args).to.deep.equal(["buildx", "enabled"]);

    // This time fail at getting buildx version
    execStub.withArgs("docker", ["buildx", "version"]).rejects();

    outputStub.resetHistory();
    await lib.main();

    // setOutput has not been called again, because buildx version failed
    expect(outputStub.callCount).to.equal(0);
  });

  it("exits 2 if no dockerfile can be found and read", async () => {
    // Short circuit by not having a dockerfile
    sandbox.stub(fs, "readFile").rejects();
    await lib.main();

    expect(exitStub.firstCall.args[0]).to.equal(2);
  });

  it("exits 3 if platform is requested but buildx is not available", async () => {
    execStub.withArgs("docker", ["buildx", "version"]).rejects();
    inputStub.returns({
      platform: "arm64",
      dockerfile: "Dockerfile",
    });

    sandbox.stub(fs, "readFile").resolves("");

    await lib.main();

    expect(exitStub.firstCall.args[0]).to.equal(3);
  });

  it("uses a build arg for ssh key by default", async () => {
    sandbox.stub(fs, "readFile").resolves("");
    const inputs = {
      dockerfile: "Dockerfile",
      githubSSHKey: "abcdefgh",
      ecrURI: "aws_account_id.dkr.ecr.region.amazonaws.com",
    };
    inputStub.returns(inputs);

    await lib.main();

    const buildArgs = buildStub.getCall(0).args[0];

    expect(
      buildArgs.includesInOrder(
        "--build-arg",
        `GITHUB_SSH_KEY=${inputs.githubSSHKey}`
      )
    ).to.be.true;
  });

  it("writes an ssh key if ssh mount is requested in dockerfile", async () => {
    sandbox.stub(fs, "readFile").resolves("mount=type=ssh");
    const inputs = {
      dockerfile: "Dockerfile",
      githubSSHKey: Buffer.from("abcdefgh", "utf8").toString("base64"),
      ecrURI: "aws_account_id.dkr.ecr.region.amazonaws.com",
    };
    inputStub.returns(inputs);
    const chmodStub = sandbox.stub(fs, "chmod").resolves();

    await lib.main();

    expect(writeFileStub.firstCall.args[1]).to.equal("abcdefgh");
    expect(chmodStub.firstCall.args[1]).to.equal("0600");

    const buildArgs = buildStub.getCall(0).args[0];
    expect(
      buildArgs.includesInOrder(
        "--build-arg",
        `GITHUB_SSH_KEY=${inputs.githubSSHKey}`
      )
    ).to.be.false;
    expect(
      buildArgs.includesInOrder(
        "--ssh",
        "default"
      )
    ).to.be.true;
  });

  it("injects an .npmrc if secret mount is requested with id=npmrc", async () => {
    sandbox.stub(fs, "readFile").resolves("--mount=type=secret,id=npmrc,target=/app/.npmrc");
    const inputs = {
      dockerfile: "Dockerfile",
      // githubSSHKey: Buffer.from("abcdefgh", "utf8").toString("base64"),
      ecrURI: "aws_account_id.dkr.ecr.region.amazonaws.com",
    };
    inputStub.returns(inputs);
    // const chmodStub = sandbox.stub(fs, "chmod").resolves();

    await lib.main();

    expect(writeFileStub.firstCall.args[1]).to.equal("@glg:registry=https://npm.pkg.github.com\nnpm.pkg.github.com/:_authToken=undefined");
    // expect(chmodStub.firstCall.args[1]).to.equal("0600");

    const buildArgs = buildStub.getCall(0).args[0];
    expect(
      buildArgs.includesInOrder(
        "--secret",
        "id=npmrc,src=/tmp/.npmrc"
      )
    ).to.be.true;
  });

  it("passes the git sha as a build arg only if used in the dockerfile", async () => {
    const readStub = sandbox.stub(fs, "readFile").resolves("GITHUB_SHA");
    const inputs = {
      dockerfile: "Dockerfile",
      githubSSHKey: "abcdefgh",
      ecrURI: "aws_account_id.dkr.ecr.region.amazonaws.com",
    };
    inputStub.returns(inputs);

    await lib.main();

    let buildArgs = buildStub.getCall(0).args[0];
    expect(
      buildArgs.includesInOrder("--build-arg", `GITHUB_SHA=${context.sha}`)
    ).to.be.true;

    readStub.resolves("");
    buildStub.resetHistory();

    await lib.main();

    // Without GITHUB_SHA in the dockerfile, it will not add the build arg
    buildArgs = buildStub.getCall(0).args[0];
    expect(
      buildArgs.includesInOrder("--build-arg", `GITHUB_SHA=${context.sha}`)
    ).to.be.false;
  });

  it("allows specifying an alternate dockerfile", async () => {
    sandbox.stub(fs, "readFile").resolves("");
    const inputs = {
      dockerfile: "prod.dockerfile",
      githubSSHKey: "abcdefgh",
      ecrURI: "aws_account_id.dkr.ecr.region.amazonaws.com",
    };
    inputStub.returns(inputs);

    await lib.main();

    const buildArgs = buildStub.getCall(0).args[0];
    expect(buildArgs.includesInOrder("-f", inputs.dockerfile)).to.be.true;
  });

  it("allows passing in a build config", async () => {
    sandbox.stub(fs, "readFile").resolves("");
    const inputs = {
      dockerfile: "Dockerfile",
      ecrURI: "aws_account_id.dkr.ecr.region.amazonaws.com",
      buildConfig: "buildconfig.json",
    };
    inputStub.returns(inputs);

    await lib.main();

    const buildArgs = buildStub.getCall(0).args[0];
    expect(
      buildArgs.includesInOrder(
        "--build-arg",
        `BUILD_CONFIG=${inputs.buildConfig}`
      )
    ).to.be.true;
  });

  it("allows specifying an alternate platform", async () => {
    sandbox.stub(fs, "readFile").resolves("");
    const inputs = {
      dockerfile: "Dockerfile",
      ecrURI: "aws_account_id.dkr.ecr.region.amazonaws.com",
      platform: "arm64",
    };
    inputStub.returns(inputs);

    await lib.main();

    const buildArgs = buildStub.getCall(0).args[0];
    expect(buildArgs.includesInOrder("--platform", inputs.platform, "--load"))
      .to.be.true;
  });

  it("looks for a RUN heredoc and sets environment variables if present", async () => {
    sandbox.stub(fs, "readFile").resolves("RUN << some commands");
    const inputs = {
      dockerfile: "Dockerfile",
      ecrURI: "aws_account_id.dkr.ecr.region.amazonaws.com",
      platform: "arm64",
    };
    inputStub.returns(inputs);

    await lib.main();

    const buildEnv = buildStub.getCall(0).args[1];
    expect(buildEnv).to.deep.equal({
      DOCKER_BUILDKIT: 1,
      BUILDKIT_PROGRESS: "plain",
    });
  });

  it("looks for a RUN heredoc wth mount arguments and sets environment variables if present", async () => {
    sandbox.stub(fs, "readFile").resolves("RUN --mount=type=ssh <<EOF");
    const inputs = {
      dockerfile: "Dockerfile",
      ecrURI: "aws_account_id.dkr.ecr.region.amazonaws.com",
      platform: "arm64",
    };
    inputStub.returns(inputs);

    await lib.main();

    const buildEnv = buildStub.getCall(0).args[1];
    expect(buildEnv).to.deep.equal({
      DOCKER_BUILDKIT: 1,
      BUILDKIT_PROGRESS: "plain",
      SSH_AUTH_SOCK: "/tmp/ssh_agent.sock"
    });
  });

  it("looks for a COPY heredoc and sets environment variables if present", async () => {
    sandbox.stub(fs, "readFile").resolves("COPY << some commands");
    const inputs = {
      dockerfile: "Dockerfile",
      ecrURI: "aws_account_id.dkr.ecr.region.amazonaws.com",
      platform: "arm64",
    };
    inputStub.returns(inputs);

    await lib.main();

    const buildEnv = buildStub.getCall(0).args[1];
    expect(buildEnv).to.deep.equal({
      DOCKER_BUILDKIT: 1,
      BUILDKIT_PROGRESS: "plain",
    });
  });

  it("looks for a heredoc and does not set environment variables if missing", async () => {
    sandbox.stub(fs, "readFile").resolves("RUN some commands");
    const inputs = {
      dockerfile: "Dockerfile",
      ecrURI: "aws_account_id.dkr.ecr.region.amazonaws.com",
      platform: "arm64",
    };
    inputStub.returns(inputs);

    await lib.main();

    const buildEnv = buildStub.getCall(0).args[1];
    expect(buildEnv).to.deep.equal({});
  });

  it("asserts that the ecr repo exists", async () => {
    sandbox.stub(fs, "readFile").resolves("");
    const inputs = {
      dockerfile: "Dockerfile",
      ecrURI: "aws_account_id.dkr.ecr.region.amazonaws.com",
    };
    inputStub.returns(inputs);

    await lib.main();

    const assertArgs = assertRepoStub.getCall(0).args;
    expect(assertArgs[0]).to.be.an.instanceOf(ECRClient);
    expect(assertArgs[1]).to.equal(ecrRepository);
  });

  it("logs into all specified registries", async () => {
    sandbox.stub(fs, "readFile").resolves("");
    const inputs = {
      dockerfile: "Dockerfile",
      ecrURI: "aws_account_id.dkr.ecr.region.amazonaws.com",
      registries: "aws://user:pass@someuri2,aws://user:pass@someuri3",
    };
    inputStub.returns(inputs);

    await lib.main();

    const loginArgs = loginAllStub.getCall(0).args;
    expect(loginArgs[0]).to.be.an.instanceOf(ECRClient);
    expect(loginArgs[1]).to.deep.equal(inputs);
    expect(loginArgs[2]).to.equal(ecrRepository);
    expect(loginArgs[3]).to.equal(context.sha);
  });

  it("accepts a newline-separated list of build-args", async () => {
    sandbox.stub(fs, "readFile").resolves("");
    const inputs = {
      dockerfile: "Dockerfile",
      ecrURI: "aws_account_id.dkr.ecr.region.amazonaws.com",
      buildArgs: "SOMETHING=pants\nOTHER=cats",
    };
    inputStub.returns(inputs);

    await lib.main();

    const buildArgs = buildStub.getCall(0).args[0];
    expect(
      buildArgs.includesInOrder(
        "--build-arg",
        "SOMETHING=pants",
        "--build-arg",
        "OTHER=cats"
      )
    );
  });

  it("builds the image with all necessary args and envvars", async () => {
    sandbox.stub(fs, "readFile").resolves("");
    const inputs = {
      dockerfile: "Dockerfile",
      ecrURI: "aws_account_id.dkr.ecr.region.amazonaws.com",
    };
    inputStub.returns(inputs);

    await lib.main();

    const buildArgs = buildStub.getCall(0).args[0];
    expect(
      buildArgs.includesInOrder(
        "--tag",
        `${inputs.ecrURI}/${ecrRepository}:latest`,
        "--tag",
        `${inputs.ecrURI}/${ecrRepository}:${context.sha}`
      )
    );
  });

  it("healthchecks the image", async () => {
    sandbox.stub(fs, "readFile").resolves("");
    const inputs = {
      dockerfile: "Dockerfile",
      ecrURI: "aws_account_id.dkr.ecr.region.amazonaws.com",
      healthcheck: "/healthcheck",
    };
    inputStub.returns(inputs);

    await lib.main();

    expect(healthcheckStub.callCount).to.equal(1);
  });

  it("pushes the image up to all registries and tags", async () => {
    sandbox.stub(fs, "readFile").resolves("");
    const inputs = {
      dockerfile: "Dockerfile",
      ecrURI: "aws_account_id.dkr.ecr.region.amazonaws.com",
      healthcheck: "/healthcheck",
      deploy: true, // necessary for push to happen
    };
    inputStub.returns(inputs);

    await lib.main();

    expect(execLiveStub.getCall(0).args).to.deep.equal([
      "docker",
      ["push", `${inputs.ecrURI}/${ecrRepository}`, "--all-tags"],
    ]);
  });

  it("logs out of all registries", async () => {
    sandbox.stub(fs, "readFile").resolves("");
    const inputs = {
      dockerfile: "Dockerfile",
      ecrURI: "aws_account_id.dkr.ecr.region.amazonaws.com",
      healthcheck: "/healthcheck",
    };
    inputStub.returns(inputs);

    await lib.main();

    const execArgs = execStub.lastCall.args;
    expect(execArgs).to.deep.equal(["docker", ["logout", inputs.ecrURI]]);
  });
});
