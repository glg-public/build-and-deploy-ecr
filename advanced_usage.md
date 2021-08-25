# Advanced Configuration

## Custom Configuration Types

* CSV - comma-delimited string
    ```yaml
    csv: foo,bar,baz
    ```
* list - new line delimited list of values
    ```yaml
    list: |
      first=one
      two=deux
    ```

## Options

| Input | Type | Description | Default |
|---|---|---|---|
| architecture | String | image architecture | '' |
| build-args | List | build arguments pass to `docker build` command | '' |
| platform | String | image platform | '' |
| registries | CSV/List | additional registries to push this image to | '' |

## `architecture` and `platform` details

These are often used in together. Depending on your requirements, you may need to run Docker's
`setup-qemu-action` and `setup-buildx-action` actions to prepare the environment for
`build-and-deploy-ecr` to run.

### Example Usage (with preamble)

```yaml
- uses: docker/setup-qemu-action@v1
  with:
    platforms: linux/arm64
- uses: docker/setup-buildx-action@v1
  with:
    install: true
    version: latest
- uses: glg-public/build-and-deploy-ecr@main
  with:
    architecture: arm64
    platform: linux/arm64
```

## `build-args` details

These are passed directly to the `docker build` command. They should be in the same format as you
would use them on the command line. Here is an example of the command-line usage of `build-args`:

```shell
docker build --build-arg HELLO=world --build-arg cat=pants .
```

Those options translated to `yaml` would look like the following:

```yaml
with:
  build-args: |
    HELLO=world
    cat=pants
```

## `registries` details

This is used to push the same image to multiple repositories at once. This is accomplished by
adding additional tags to the image for the appropriate repositories. The format for each repo is:

```
<repo-type>://<username>:<password>@<registry-uri>
```

The only `repo-type` currently supported is `aws`. The `AWS_ACCESS_KEY_ID` functions as the username
and the `AWS_SECRET_ACCESS_KEY` functions as the password. You can pass multiple registries at once.

### Example Usage

```yaml
- uses: glg-public/build-and-deploy-ecr@main
  with:
    access_key_id: ${{ secrets.username }}
    secret_access_key: ${{ secrets.password }}
    ecr_uri: ${{ secrets.registry-uri }}
    registries: |
      aws://${{ secrets.AWS_ACCESS_KEY_ID }}:${{ secrets.AWS_SECRET_ACCESS_KEY }}@${{ secrets.ECR_URI }}
      aws://${{ secrets.ANOTHER_KEY_ID }}:${{ secrets.ANOTHER_ACCESS_KEY }}@${{ secrets.ANOTHER_ECR_URI }}
```

Take note of the `|` after `registries:` in the YAML. Alternatively you can pass the registries in
a single line of comma-separated values.


```yaml
with:
  registries: aws://foo:bar@baz,aws://qux:quux@catpants
```

Note: The `registries` setting is used in conjunction with your default credentials for your main
build. They are not a replacement for those settings.
