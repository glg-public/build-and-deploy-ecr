const sinon = require("sinon");
const lib = require("../lib");
const core = require("@actions/core");
const github = require("@actions/github");
const fs = require("fs").promises;
const { expect } = require("chai");
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
  execLiveStub;
const version = "Client:\n  Version: 20.10.2";
const buildxVersion = "something about buildx version";
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
    logStub = sandbox.stub(console, "log");
    outputStub = sandbox.stub(core, "setOutput");

    assertRepoStub = sandbox.stub(lib.util, "assertECRRepo").resolves();
    loginAllStub = sandbox
      .stub(lib.util, "loginToAllRegistries")
      .resolves({ dockerBuildArgs: [], hosts: [] });
    buildStub = sandbox.stub(lib.util, "dockerBuild").resolves();
    healthcheckStub = sandbox.stub(lib.util, "runHealthcheck").resolves();
    execLiveStub = sandbox.stub(lib.util, "execWithLiveOutput").resolves();

    sandbox.stub(github, "context").get(() => {});

    sandbox.stub(core, "error");
    sandbox.stub(core, "startGroup");
    sandbox.stub(core, "endGroup");
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
    };
    inputStub.returns(inputs);

    await lib.main();

    const buildArgs = buildStub.getCall(0).args[0];

    expect(
      buildArgs.includesInOrder(
        "--build-arg",
        `GITHUB_SSH_KEY=${inputs.githubSSHKey}`
      )
    );
  });

  it("writes an ssh key if ssh mount is requested in dockerfile");

  it("passes the git sha as a build arg only if used in the dockerfile");

  it("allows specifying an alternate dockerfile");

  it("allows passing in a build config");

  it("allows specifying an alternate platform");

  it("looks for a RUN heredoc and sets environment variables if present");

  it("asserts that the ecr repo exists");

  it("logs into all specified registries");

  it("accepts a newline-separated list of build-args");

  it("builds the image with all necessary args and envvars");

  it("healthchecks the image");

  it("pushes the image up to all registries and tags");

  it("logs out of all registries");
});
