const sinon = require("sinon");
const lib = require("../lib");
const core = require("@actions/core");
const fs = require("fs").promises;
const { expect } = require("chai");
const exp = require("constants");
const sandbox = sinon.createSandbox();

let inputStub, execStub, logStub, outputStub, exitStub;
const version = "Client:\n  Version: 20.10.2";
const buildxVersion = "something about buildx version";
describe("Main Workflow", () => {
  beforeEach(() => {
    sandbox.restore();
    inputStub = sandbox.stub(lib.util, "getInputs");

    execStub = sandbox.stub(lib.util, "execFile");
    execStub.withArgs("docker", ["version"]).resolves({ stdout: version });

    exitStub = sandbox.stub(process, "exit");

    logStub = sandbox.stub(console, "log");

    outputStub = sandbox.stub(core, "setOutput");

    sandbox.stub(core, "error");
    sandbox.stub(core, "startGroup");
    sandbox.stub(core, "endGroup");
  });

  after(() => {
    sandbox.restore();
  });

  it("outputs the docker version", async () => {
    execStub.resolves({ stdout: "hello world" });

    // Short circuit by not having a dockerfile
    sandbox.stub(fs, "readFile").rejects();
    await lib.main();

    expect(logStub.firstCall.args[0]).to.equal(version);
  });

  it("checks for docker buildx and sets an output if available", async () => {
    execStub.resolves({ stdout: "hello world" });
    execStub
      .withArgs("docker", ["buildx", "version"])
      .resolves({ stdout: buildxVersion });

    // Short circuit by not having a dockerfile
    sandbox.stub(fs, "readFile").rejects();
    await lib.main();

    expect(logStub.secondCall.args[0]).to.equal(buildxVersion);
    expect(outputStub.callCount).to.equal(1);
    expect(outputStub.firstCall.args).to.deep.equal(["buildx", "enabled"]);

    // This time fail at getting buildx version
    execStub.withArgs("docker", ["buildx", "version"]).rejects();

    await lib.main();

    // setOutput has not been called again, because buildx version failed
    expect(outputStub.callCount).to.equal(1);
  });

  it("exits 2 if no dockerfile can be found and read", async () => {
    execStub.resolves({ stdout: "hello world" });

    // Short circuit by not having a dockerfile
    sandbox.stub(fs, "readFile").rejects();
    await lib.main();

    expect(exitStub.firstCall.args[0]).to.equal(2);
  });

  it("exits 3 if platform is requested but buildx is not available", async () => {
    execStub.resolves({ stdout: "hello world" });
    execStub.withArgs("docker", ["buildx", "version"]).rejects();
    inputStub.returns({
      platform: "arm64",
      dockerfile: "Dockerfile",
    });

    sandbox.stub(fs, "readFile").resolves("");

    await lib.main();

    expect(exitStub.firstCall.args[0]).to.equal(3);
  });

  it("uses a build arg for ssh key by default", async () => {});

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
