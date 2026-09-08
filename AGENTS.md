# 项目维护约束

只操作本仓库与本次明确授权的项目目录。不得扫描其他项目、上传浏览器配置或打印/复制凭证；需要远程设备操作时先确认用户授权。Windows 不做 GitHub 登录；使用已授权服务器的既有 gh 凭证。

## 数据规则
- 学校实体 id 与校区 uid 分开；不同独立学院不得只凭相似名称并校。
- 校区必须保留 sourceUrl、sourceKind 与核验状态。官网/政府关联不等于当年办学、招生和精确坐标均已核验。
- 只有县区归属线索、没有校园门牌时写入 `data/district-associations.jsonl`；该层禁止 address/lng/lat，不计作 campus。
- 不编造县区、校区、经纬度或排名。缺坐标留空；缺数据不写成当地没有高校。
- 本科优先、专科补位是候选规则，不是质量断言；分类排名不得冒充统一总排名。
- 数据更新同时维护统计、缺失清单与依据。不得为了提高覆盖率强行猜测地址。

## 变更验收
修改 src 或 data 后依次运行 `python3 scripts/build.py`、`python3 scripts/validate.py`、`python3 scripts/build.py --check`。有可用 Chrome 时运行 `node tests/browser.mjs`，确认断网零 HTTP 请求。仅在用户授权发布时提交/推送或创建 Release。

不直接只改 dist。正常构建必须离线、无第三方 Python 依赖，并保持相同输入生成相同 HTML。读取 archive 仅为审计，不能把历史管线中的机器路径当成新的工作路径。
