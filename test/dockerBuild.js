const { expect } = require("chai");
const sinon = require("sinon");
const lib = require("../lib");

const sandbox = sinon.createSandbox();

let execStub;

describe("lib.dockerBuild", () => {
  beforeEach(() => {
    sandbox.restore();
    execStub = sandbox.stub(lib.util, "execWithLiveOutput").resolves();
  });

  after(() => {
    sandbox.restore();
  });

  it("runs docker build in the current directory", async () => {
    const args = ["arg1", "arg2"];
    await lib.dockerBuild(args);
    expect(execStub.calledOnce).to.be.true;

    const execArgs = execStub.firstCall.args;
    expect(execArgs[0]).to.equal("docker");
    expect(execArgs[1]).to.deep.equal(["build", ...args, "."]);
  });

  it("accepts an optional environment object", async () => {
    await lib.dockerBuild([], { hello: "world" });
    expect(execStub.calledOnce).to.be.true;

    const execArgs = execStub.firstCall.args;
    expect(execArgs[2]).to.deep.equal({ hello: "world" });
  });
});
