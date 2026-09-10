# 全国高校离线地图 · China University Atlas

真实行政区轮廓，**全国 → 省 → 市 → 县区**逐级查看；学校主体与校区分开建模，同一大学可以跨县区、跨城市出现。

**[下载离线 HTML](https://github.com/ProfessorZhi/china-university-atlas/releases/latest/download/china-university-atlas.html)** · **[版本与完整数据包](https://github.com/ProfessorZhi/china-university-atlas/releases)** · [数据来源](data/sources.json) · [覆盖与缺口](reports/coverage.json)

下载 HTML 后用现代浏览器直接打开，不需要服务器、账号、API 密钥或首次联网。地图边界、脚本、样式和运行数据全部内嵌；系统字体不随文件分发。GitHub 文件预览不是网页运行入口，请下载 HTML。

![全国地图](docs/national-desktop.png)

## 当前版本与范围

V5.3.0 在 V5.2 的地点证据分层基础上，进一步把**学校主体状态、最低法定行政边界、实际办学地点、异地办学 presence 与版本化事实层**拆开。当前活跃普通高校在学校层面已无“缺任何地点证据”或“只有市级地点”的已知缺口；这不等于每一条 campus 记录都已经有精确门牌或坐标。

| 内容 | 当前快照 |
|---|---:|
| 普通高校主体 / 成人高校主体 | 2,952 / 244 |
| 活跃普通高校 / 已解析失活普通高校 | 2,935 / 17 |
| 校区、办学地点记录 | 6,817 |
| 活跃普通高校缺任何地点证据 / 仅有市级地点 | 0 / 0 |
| 活跃普通高校无 campus 记录 / 仅县区证据 | 4 / 4 |
| campus 已到最低法定边界 / 仍仅城市级 | 6,089 / 728 |
| 有具体校园地点的县区 / 有候选证据的县区 / 源县区轮廓 | 1,235 / 1,238 / 2,840 |
| 县区归属证据 / 待补新设行政区边界学校 | 35 / 2 |
| 异地办学 presence 城市 / 条目 | 2 / 7 |
| 排名事实 / 覆盖学校 | 27 / 10 |

本轮语义、城市层和验收变化详见 [V5.3 说明](docs/v5.3.md)；上一轮地点证据分层见 [V5.2 说明](docs/v5.2.md)。

数据日期为 2026-09-09；学校主体来自教育部 2026 名录的 CSV 镜像。**地点记录数不等于互不重复的独立校园数。** 当前 728 条仅到城市层级的 campus 记录属于记录级精度债务，并不表示 728 所学校仍只有市级位置：2,935 所活跃普通高校均已至少有一条最低法定行政边界级证据。4 所学校目前只有县区/等效法定边界证据、尚无精确 campus 记录。草湖市、新星市两项属于离线底图尚未包含新设法定边界，不是学校位置缺失。

“最佳高校”是当前资料与默认排序规则下的参考候选，不是官方评定：本科优先、专科补位；再按学校标签和排名来源顺序排序。分类榜不等于统一全国排名，无排名时名称排序不能代表质量。省级按学校主体所在地；**城市主榜只允许本地主体高校参与**，异地本科校区/分校与研究生院/研究院只作为附加 presence 展示；县区按实际地点归属。开启“包含异地办学”后，有异地 presence 的城市会在本地主体高校名后显示 `＋`，悬浮查看分层信息，但不会改变本地主榜候选。学校整体排名不代表每个校区教学质量。

## 目录与修改方式

- `src/`：HTML 模板、样式与交互脚本；`dist/`：可直接使用的离线 HTML。
- `data/universities.jsonl`、`data/campuses.jsonl`：每行一个实体；`uid` 关联学校 `id`。`data/district-associations.jsonl` 单独保存县区归属证据，不允许包含校园地址或经纬度。`data/city-affiliates.json` 保存城市异地办学 presence；`data/*facts*`、`data/rankings.jsonl` 等保存版本化事实。`regions.json`、`metadata.json` 与边界压缩文件共同组成地图数据。
- `data/overrides/`：更名与官网核对依据；`data/sources/`：名录、排名字段及精简地址档案快照，不收录第三方长篇学校介绍。
- `reports/`：确定性的覆盖数量、缺失学校、城市级记录、待核地址、状态与事实表。浏览器断网测试报告属于 CI 运行产物，在 Actions artifact 中保存，不作为长期提交快照。
- `archive/windows-v5/`：迁移时保留的历史构建管线，供审计；当前正常构建以 `scripts/build.py` 为准。

修改 `data/` 或 `src/` 后，先生成派生表，再构建和验证：

```bash
python3 scripts/generate_reports.py
python3 scripts/build.py
python3 scripts/validate.py
python3 scripts/validate_facts.py
python3 scripts/generate_reports.py --check
python3 scripts/build.py --check
node tests/browser.mjs  # 可选；Node.js 22+，已安装 Chrome，可设置 CHROME_BIN
python3 scripts/build.py --zip
```

常规构建仅用 Python 标准库、无网络；同一组输入产生同一 HTML。CI 检查派生表一致性、数据与事实层、隐私扫描、离线浏览器行为和重建一致性。缺坐标不填县城中心点；缺地点不标成“当地无高校”；新增校区必须保留来源与核验状态；只有县区线索时写入 association 层，不能冒充 campus；异地办学实体不能冒充城市本地主体高校。详见 [AGENTS.md](AGENTS.md)、[数据使用说明](NOTICE.md) 和 [迁移说明](docs/migration.md)。