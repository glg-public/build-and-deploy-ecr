const { expect } = require("chai");
const sinon = require("sinon");
const lib = require("../lib");
const core = require("@actions/core");

const sandbox = sinon.createSandbox();

const imageName = "myimage:latest";
const defaultInputs = {
  port: "3000",
  healthcheck: "/healthcheck",
};

let execStub;

describe("lib.runHealthcheck", () => {
  beforeEach(() => {
    sandbox.restore();

    // Comment this out when debugging tests
    sandbox.stub(console, "log");
    sandbox.stub(core, "error");
    sandbox.stub(core, "warning");
    sandbox.stub(core, "startGroup");
    sandbox.stub(core, "endGroup");

    execStub = sandbox
      .stub(lib.util, "execFile")
      .resolves({ stdout: "someoutput" });
    sandbox.stub(lib.util, "sleep").resolves();
  });
  after(() => {
    sandbox.restore();
  });

  it("starts a  docker container with exposed ports", async () => {
    sandbox.stub(lib.util, "httpGet").resolves();

    await lib.runHealthcheck(imageName, defaultInputs);

    const dockerRunArgs = execStub.getCall(0).args[1];

    // Container will be detached
    expect(dockerRunArgs).to.include("--detach");

    // Container will have a port mapped to the host
    expect(dockerRunArgs).to.include(
      `${defaultInputs.port}:${defaultInputs.port}`
    );

    // Container will have a healthcheck defined
    expect(dockerRunArgs).to.include(
      `HEALTHCHECK=${defaultInputs.healthcheck}`
    );

    // Container will have the exposed port in it's env
    expect(dockerRunArgs).to.include(`PORT=${defaultInputs.port}`);

    // Last arg passed to docker run will be the image name
    expect(dockerRunArgs.pop()).to.equal(imageName);
  });

  it("adds an env file if specified in inputs", async () => {
    sandbox.stub(lib.util, "httpGet").resolves();

    const inputs = {
      ...defaultInputs,
      envFile: "healthcheck.env",
    };
    await lib.runHealthcheck(imageName, inputs);

    const dockerRunArgs = execStub.getCall(0).args[1];

    expect(dockerRunArgs).to.include("--env-file");
    expect(dockerRunArgs).to.include(inputs.envFile);
  });

  it("tries to poll the healthcheck 5 times and then exits 1", async () => {
    const httpStub = sandbox.stub(lib.util, "httpGet").rejects();
    const exitStub = sandbox.stub(process, "exit");

    await lib.runHealthcheck(imageName, defaultInputs);

    expect(httpStub.callCount).to.equal(5);
    expect(exitStub.calledWith(1)).to.be.true;
  });

  it("resolves successfully when healthcheck passes", async () => {
    sandbox.stub(lib.util, "httpGet").resolves();
    return expect(lib.runHealthcheck(imageName, defaultInputs)).to.be.fulfilled;
  });

  it("stops the docker container at the end", async () => {
    sandbox.stub(lib.util, "httpGet").resolves();

    await lib.runHealthcheck(imageName, defaultInputs);

    expect(execStub.lastCall.args[1]).to.deep.equal(["stop", "test-container"]);
  });
});
