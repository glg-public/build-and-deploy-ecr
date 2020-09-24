# build-and-deploy-ecr
This github action builds a docker image from a dockerfile, and pushes it to ECR in compliance with GLG naming conventions

## Requirements

This action requires certain things to be configured in your repo:

1. You must have a dockerfile in the root directory of your repo.
2. You must have the following **secrets** present in your repository. These should be added automatically by a different process.
    1. `ECR_URI`
    2. `ECR_AWS_ACCESS_KEY_ID`
    3. `ECR_AWS_SECRET_ACCESS_KEY`
3. This action was developed against the `ubuntu-20.04` github actions environment, and it may not work correctly in a different environment.

## Example Usage

```yml
name: Build Image and Push to ECR
on: [push]
jobs:
  build-and-deploy:
    runs-on: ubuntu-20.04
    steps:
    - uses: actions/checkout@main
    - uses: glg-public/build-and-deploy-ecr@main
```
