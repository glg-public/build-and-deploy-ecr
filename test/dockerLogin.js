const sinon = require("sinon");
const core = require("@actions/core");
const { GetAuthorizationTokenCommand } = require("@aws-sdk/client-ecr");
const lib = require("../lib");

const sandbox = sinon.createSandbox();

let execStub;
const client = {
  send: async () => {
    throw new Error();
  },
};

describe("lib.util.dockerLogin", () => {
  beforeEach(() => {
    sandbox.restore();

    // Comment this out when debugging tests
    sandbox.stub(console, "log");
    sandbox.stub(core, "error");

    execStub = sandbox
      .stub(lib.util, "execFile")
      .resolves({ stdout: "someoutput" });
  });

  after(() => {
    sandbox.restore();
  });

  it("exits 4 if it can't get an auth token", async () => {
    const exitStub = sandbox.stub(process, "exit");
    await lib.util.dockerLogin(client, "someuri");

    expect(exitStub.calledWith(4)).to.be.true;
  });

  it("masks the ecr password as a secret", async () => {
    const user = "user";
    const pass = "pass";
    sandbox
      .stub(client, "send")
      .withArgs(sinon.match.instanceOf(GetAuthorizationTokenCommand))
      .resolves({
        authorizationData: [
          {
            authorizationToken: Buffer.from(`${user}:${pass}`, "utf8").toString(
              "base64"
            ),
          },
        ],
      });

    const coreStub = sandbox.stub(core, "setSecret");

    await lib.util.dockerLogin(client, "someuri");

    expect(coreStub.calledWith(pass)).to.be.true;
  });

  it("runs docker login with the fetched creds", async () => {
    const user = "user";
    const pass = "pass";
    sandbox
      .stub(client, "send")
      .withArgs(sinon.match.instanceOf(GetAuthorizationTokenCommand))
      .resolves({
        authorizationData: [
          {
            authorizationToken: Buffer.from(`${user}:${pass}`, "utf8").toString(
              "base64"
            ),
          },
        ],
      });

    sandbox.stub(core, "setSecret");

    await lib.util.dockerLogin(client, "someuri");

    const execArgs = execStub.firstCall.args;
    expect(execArgs[0]).to.equal("docker");
    expect(execArgs[1][0]).to.equal("login");
    expect(execArgs[1]).to.include(user);
    expect(execArgs[1]).to.include(pass);
    expect(execArgs[1].pop()).to.equal("someuri");
  });
});
