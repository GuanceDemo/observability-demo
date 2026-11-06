# Demo 集群凭证：30 天有效期

此凭证用于本地工作台访问集群。通过 Kubernetes 客户端证书 CSR 请求 30 天有效期，最终以签名证书的 notBefore/notAfter 为准；不扩大原身份或 RBAC 权限。

## 下次续期

这是 Kubernetes 客户端证书，不是 ACK 临时凭据接口签发的凭证。目前没有自动续期；在到期前重新签发同身份、同有效期证书，然后导入。

1. 在本机的私有临时目录（0700）生成新私钥与 CSR。读取当前 kubeconfig 中客户端证书的 CN/O，保留这些身份字段，不添加新权限组。私钥文件设为 0600，只留在本机。不要从管理机复制管理员私钥或 kubeconfig。
2. 将 **公共 CSR** 交给现有管理机，核对目标 CA 和申请身份后创建下列对象；名称应唯一。

```yaml
apiVersion: certificates.k8s.io/v1
kind: CertificateSigningRequest
metadata:
  name: vehicle-demo-client-<unique-suffix>
  labels:
    app.kubernetes.io/managed-by: vehicle-demo-api-control
spec:
  request: <base64-encoded-public-CSR>
  signerName: kubernetes.io/kube-apiserver-client
  expirationSeconds: 2592000
  usages: [client auth]
```

3. 在已核对目标的管理机执行 `kubectl create -f request.yaml`，再执行 `kubectl certificate approve <exact-request-name>`。仅批准这一份已核对主体的 CSR。从该对象的 `status.certificate` 取回签名证书（Base64），新私钥不传给管理机。
4. 在本机复制现有的最小化 kubeconfig 到私有候选文件，仅替换当前用户的 `client-certificate-data`、`client-key-data`；保留 context、服务器地址、CA 与 TLS 校验设置。不要修改默认 `~/.kube/config`。
5. 核对签名证书的真实 `notBefore`/`notAfter`（应为 30 天），证书公钥与新私钥匹配、CN/O 与原身份一致。用候选 kubeconfig 运行 `kubectl auth whoami -o json`，对比新旧身份，并验证原有允许和拒绝的操作。不要通过扩大 RBAC 让新证书通过检查。
6. 检查通过后导入：

```sh
python3 scripts/vehicle-demo/configure-local-kube.py \
  --kubeconfig /private/path/candidate-config --context EXISTING_CONTEXT
```

导入器会记录签名证书真实到期时间，拒绝过期或无法解析的证书。验证 `/api/vehicle/faults` 返回正常后，删除候选文件和额外私钥副本，仅保留 `.local-work/vehicle-demo/kube/config` 中的生效凭证。CSR 只含公共信息，可作为审计记录。

## 防止退回一天

省略 `--temporary-duration-minutes` 的旧 ACK 命令不会覆盖一个到期时间更晚的现有配置；失败时三个生效文件均保持原样。只有明确指定 15～4320 分钟才允许切回 ACK 临时凭据。不能填写 43200，也不能通过删除该参数获取三年证书后声称它只有一个月有效。


参考：[ACK 临时凭据接口](https://www.alibabacloud.com/help/en/ack/ack-managed-and-ack-dedicated/developer-reference/api-cs-2015-12-15-describeclusteruserkubeconfig)、[Kubernetes 客户端证书签发](https://kubernetes.io/docs/tasks/tls/certificate-issue-client-csr/)。
