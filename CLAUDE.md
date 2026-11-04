# 项目说明（给 Claude）

本仓库当前开发内容是中文单人浏览器游戏「星空列车」（Vite + TypeScript，DOM + Canvas，程序绘制，无外部素材）。原有的「暗影地牢」已保留，不要删除或覆盖。

## 先读这些

- `docs/HANDOFF.md`：当前分支、最新提交、完成/未完成、已知问题、实际测试与线上版本、下一步任务。
- `docs/GAME_DESIGN.md`：最新有效游戏规则（含已废弃方案与临时数值的区分）。
- `README.md`：玩家向说明与已实现内容。

## 发布路径与部署保护

- 星空列车开发分支：`claude/zealous-davinci-j32qp4`，推送即通过 `.github/workflows/deploy.yml` 发布到 https://jebrz.github.io/game/star-train/ 。
- 地下城：https://jebrz.github.io/game/ ，内容来自提交 `59092fa`（分支 `claude/serene-ritchie-qv18mk`，备份分支 `backup/dungeon-game`）。工作流会把地下城按该提交原样重建，并在部署前逐字节核对线上文件，不一致即中止——不要移除或绕过这项检查。
- 部署前工作流会运行 `npm run check`（类型检查含 `tests/`）；类型错误会阻止发布。runner 排队时不要重复触发部署。
- 部署后核对：线上 `star-train/` 的脚本文件名应与本地 `dist/index.html` 一致；地下城脚本应仍为 `assets/index-1VxXLNq2.js`。

## 存档兼容

- 存档带版本号（`SAVE_VERSION` 在 `src/config/balance.ts`），迁移函数在 `src/sim/save.ts`（v1→v6 链式迁移）。修改状态结构时必须：提升版本、补迁移、更新 `tests/legacy.ts`、加迁移测试。
- 不要求玩家清档；读档不能重发奖励、重复扣费或重新随机已生成的星球。
- 星空列车只使用 `startrain.` 前缀的浏览器存储键；地下城不使用浏览器存储。

## 开发约束

- 数值集中在 `src/config/`，是原型参数；逻辑在 `src/sim/`（纯逻辑、无 DOM），界面在 `src/ui/`。
- 暂停必须冻结一切模拟；加速只增加固定步数（1 游戏分钟/步）。
- 不要把仅有界面入口描述为已验证；正常界面验证与准备状态/调试测试分开报告。长时间界面测试用 `npm run build` + `npx vite preview`，避免开发服务器热更新刷新页面。
- 不写入令牌或凭据；提交信息不写模型名。
- 不扩展完整战斗、剧情或美术，除非用户明确要求。
