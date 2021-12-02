const { expect } = require("chai");
const sinon = require("sinon");
const lib = require("../lib");
const {
  DescribeRepositoriesCommand,
  CreateRepositoryCommand,
  SetRepositoryPolicyCommand,
} = require("@aws-sdk/client-ecr");
const ecrPolicy = require("../ecr-policy.json");

const sandbox = sinon.createSandbox();
const client = {
  send: async () => {
    throw new Error();
  },
};

describe("lib.assertECRRepo", () => {
  beforeEach(() => {
    sandbox.restore();
  });

  after(() => {
    sandbox.restore();
  });

  it("resolves immediately if the repo already exists", async () => {
    const sendStub = sandbox
      .stub(client, "send")
      .withArgs(sinon.match.instanceOf(DescribeRepositoriesCommand))
      .resolves();

    await lib.assertECRRepo(client, "somerepo");
    expect(sendStub.calledOnce).to.be.true;
    expect(sendStub.firstCall.args[0].input).to.deep.equal({
      repositoryNames: ["somerepo"],
    });
  });

  it("creates a repository if it does not exist", async () => {
    const notFoundError = new Error();
    notFoundError.name = "RepositoryNotFoundException";

    const sendStub = sandbox.stub(client, "send").rejects(new Error());
    sendStub
      .withArgs(sinon.match.instanceOf(DescribeRepositoriesCommand))
      .rejects(notFoundError);

    sendStub
      .withArgs(sinon.match.instanceOf(CreateRepositoryCommand))
      .resolves();

    sendStub
      .withArgs(sinon.match.instanceOf(SetRepositoryPolicyCommand))
      .resolves();

    await lib.assertECRRepo(client, "somerepo");

    // Describe Request
    expect(sendStub.getCall(0).args[0].input).to.deep.equal({
      repositoryNames: ["somerepo"],
    });

    // Create Request
    expect(sendStub.getCall(1).args[0].input).to.deep.equal({
      repositoryName: "somerepo",
      tags: [{ Key: "ManagedBy", Value: "GitHub" }],
    });

    // Set Policy Request
    expect(sendStub.getCall(2).args[0].input).to.deep.equal({
      repositoryName: "somerepo",
      policyText: JSON.stringify(ecrPolicy),
    });
  });

  it("rejects if it can't use DescribeRepository", async () => {
    return expect(lib.assertECRRepo(client, "somerepo")).to.be.rejected;
  });

  it("it rejects if it can't create a new ecr repo", async () => {
    const notFoundError = new Error();
    notFoundError.name = "RepositoryNotFoundException";

    const sendStub = sandbox.stub(client, "send").resolves();
    sendStub
      .withArgs(sinon.match.instanceOf(DescribeRepositoriesCommand))
      .rejects(notFoundError);

    sendStub
      .withArgs(sinon.match.instanceOf(CreateRepositoryCommand))
      .rejects();

    return expect(lib.assertECRRepo(client, "somerepo")).to.be.rejectedWith(
      Error,
      /not create ecr repo/i
    );
  });

  it("it rejects if it can't set an ecr policy", async () => {
    const notFoundError = new Error();
    notFoundError.name = "RepositoryNotFoundException";

    const sendStub = sandbox.stub(client, "send").rejects(new Error());
    sendStub
      .withArgs(sinon.match.instanceOf(DescribeRepositoriesCommand))
      .rejects(notFoundError);

    sendStub
      .withArgs(sinon.match.instanceOf(CreateRepositoryCommand))
      .resolves();

    sendStub
      .withArgs(sinon.match.instanceOf(SetRepositoryPolicyCommand))
      .rejects();

    return expect(lib.assertECRRepo(client, "somerepo")).to.be.rejectedWith(
      Error,
      /not set ecr policy/i
    );
  });
});
