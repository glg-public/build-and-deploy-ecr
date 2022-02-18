const sinon = require("sinon");
const lib = require("../lib");
const core = require("@actions/core");
const { expect } = require("chai");

const sandbox = sinon.createSandbox();

const imageName = "myimage:latest";
const defaultInputs = {
  unitTest: "npm test"
};

let execStub;

describe("lib.runUnitTest", () => {
  beforeEach(() => {
    sandbox.restore();
    // Comment this out when debugging tests
    sandbox.stub(console, "log");
    sandbox.stub(core, "error");
    sandbox.stub(core, "warning");
    sandbox.stub(core, "startGroup");
    sandbox.stub(core, "endGroup");

    execStub = sandbox.stub(lib.util, "execFile").resolves({ stdout: "someoutput" });
    sandbox.stub(lib.util, "sleep").resolves();
  });

  after(() => {
    sandbox.restore();
  });
  
  const commonArgs = ["run", "--name", "test-container"]
  const inputs = [
    [{ ...defaultInputs }, [...commonArgs, "myimage:latest", "npm", "test"]],
    [{ ...defaultInputs, unitTest: "foo 'bar' test" }, [...commonArgs, "myimage:latest", "foo", "'bar'", "test"]],
    [{ ...defaultInputs, unitTest: "npm run --foo" }, [...commonArgs, "myimage:latest", "npm", "run", "--foo"]],
    [{ ...defaultInputs, unitTest: "npm run --foo '{\"foo\":123}'" }, [...commonArgs, "myimage:latest", "npm", "run", "--foo", "'{\"foo\":123}'"]],
  ]
  inputs.forEach(([input, expectedOutput]) => {
    it(`executes the provided unit_test command of ${input.unitTest} against the docker image`, async () => {  
        await lib.runUnitTest(imageName, input);
        const dockerRunArgs = execStub.getCall(0).args[1];
        expect(dockerRunArgs).to.include.ordered.members(expectedOutput);
    })
  })

  it("adds an env file if specified in inputs", async () => {
    const inputs = {
      ...defaultInputs,
      envFile: "unitTest.env"
    };
    await lib.runUnitTest(imageName, inputs);

    const dockerRunArgs = execStub.getCall(0).args[1];

    expect(dockerRunArgs.includesInOrder("--env-file", inputs.envFile)).to.be.true;
  });

  it("resolves successfully when unit tests pass", async () => {
    const inputs = { ...defaultInputs }
    return expect(lib.runUnitTest(imageName, inputs)).to.be.fulfilled;
  });

  it("should timeout successfully after 30 minutes", async () => {
    const execTimeoutMs = 1000 * 60 * 60 * 31; // 31 minutes
    const processTimeoutMs = 1000 * 60 * 60 * 30; // 30 minutes 
    const clock = sandbox.useFakeTimers();
    
    // configure stubs
    execStub
      .onFirstCall()
      .resolves(new Promise(resolve => setTimeout(() => resolve({ stdout: "timed out" }), execTimeoutMs)));
    execStub.onSecondCall().resolves({ stdout: "someoutput" });
    execStub.onThirdCall().resolves({ stdout: "someoutput" });
    const exitStub = sandbox.stub(process, "exit");

    // run function
    lib.runUnitTest(imageName, { ...defaultInputs });
    
    // advance the clock to trigger the timeout
    await clock.tickAsync(processTimeoutMs);
    
    // assertions
    const firstDockerRunArgs = execStub.getCall(1).args[1];
    const secondDockerRunArgs = execStub.getCall(2).args[1];
    expect(firstDockerRunArgs.includesInOrder("logs", "test-container")).to.be.true;
    expect(secondDockerRunArgs.includesInOrder("stop", "test-container")).to.be.true;
    expect(exitStub.calledWith(1)).to.be.true;
  });
});
