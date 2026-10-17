# dsh-minimax-h3（本地修订版）

这是一个**改过的** MiniMax H3 插件，用来替换另一台机器上 DSH 里的同名插件。
版本标识：`2026-10-17` 打包，共 22 个文件。

---

## 它修了什么（相对官方原版）

### 一、工具返回值只回显参数（这一个是真正影响使用的 bug）

`lib/tools.js` 里工具结果渲染函数的签名写错了：

```js
// 原版（错）
function renderText(value) { … }        // 契约是 render(args, value)
// 修订
function renderText(_args, value) { … }
```

后果：`h3_assets action:"ffmpeg"`、`h3_runs` 这类工具**只返回 `{"action":"ffmpeg"}` 这样的参数回显**，
拿不到真正的结果。修订后正常。

### 二、模型文件名解析（`lib/params.js`）

新增 `SLOT_INPUTS` 与"按 loader 实际advertise 的清单解析模型文件名"。
官方模板里的 unet/clip/vae/lora 是**裸文件名**，但不同服务器上的实际路径可能带子目录
（例如 `minimax/minimax_h3_fl2va_pruned_int8_convrot.safetensors`）。
修订后会先拿 `/object_info` 里的真实清单去匹配，匹配不到才回落，避免"模型明明在、却报找不到"。

### 三、帧数规则纠正（`lib/workflows.js`、`lib/tools.js`）

原版文档与提示词里写的是 **`4n+1`**，实测是错的。H3 只接受 **≡ 5 (mod 17)** 的帧数：

```
5, 22, 39, 56, 73, 90, 107, 124, 141, 158, 175, 192, 209, 226, 243, 260, 277, 294, 311, 328, 362, 481
```

（`4n+1` 与 `≡5 mod 17` 在 5/124/158 这些常用值上恰好重合，所以一直没被发现；
一旦要 73、192、226 这种就会对不上。）

### 四、随插件加载的技能内容（`lib/skill.js`，最重要）

这是做完一条 6 分钟 AI 短片后，把**真实返工过的问题**写进技能，让模型以后自动避开。
新增/重写了这几节：

- **说话人：`(S1)/(S2)` 是"谁在说"，不是备注**
  写人名（`(皇帝)`）会被当普通文字忽略 → 模型一律让画面里那个人发声，
  表现为"A 问 B 答"变成"B 自问自答"。画外音还必须明写 `Off-screen, an unseen voice`。
- **别让模型即兴说话**
  动作描述里有 "he speaks …" 而没给 `<d>` 台词，模型会自己编一句听不懂的嘟囔。
- **说"不切"往往不够**
  `Camera: locked off, no cuts.` 压不住，模型会自己切到说话人特写；
  要写成 `ONE single unbroken locked-off take … ABSOLUTELY NO CUT …`。
- **`At MM:SS.mmm` 只是"希望"**
  实测台词落点偏差 **0.6–1.5 秒**，不能用它排字幕/旁白，必须生成后实测。
- **生成后的验收（四件事）**
  台词念没念（RMS/过零率）、念的人对不对（画面左右活动量）、有没有偷偷切镜（帧间差尖峰）、
  首帧是不是要的那张（ComfyUI `LoadImage` **按输入参数缓存**，文件名不变会复用旧图）。
- **黑场/静音片段音轨要等长**
  `anullsrc` 配 `-frames:v` 会把音频截短（10.125s 的片子音频只有 7.70s）。

### 五、README（`README.md`）

新增「实测踩坑」一节：生成 8 条 + 后期 6 条对照表，给人查。

> `scripts/smoke.mjs` 也做了相应更新（离线自测覆盖新增的解析逻辑）。

---

## 怎么装

插件是**纯 JS，没有构建步骤**，直接替换目录即可。

```bash
# 1) 先备份原来的
cd <你的 DSH 配置目录>/profiles/node_modules
mv dsh-minimax-h3 dsh-minimax-h3.bak-$(date +%Y%m%d)

# 2) 解包到同一层
tar -xzf dsh-minimax-h3-custom-20261017.tar.gz -C .
#    解出来就是 ./dsh-minimax-h3

# 3) 校验语法（可选，但建议）
node --check dsh-minimax-h3/lib/skill.js
node --check dsh-minimax-h3/lib/tools.js

# 4) 重启 DSH
```

**注意路径**：装到 DSH **实际加载**的位置。本机是
`/data/dsh/profiles/node_modules/dsh-minimax-h3`；
而你机器上可能是 `~/.dsh/profiles/node_modules/` 或其他 profile 目录，**以实际为准**。

如果 `/opt/dsh-plugins/dsh-minimax-h3` 也存在，那通常是**只读的原始副本**，不用动它——
DSH 加载的是 `profiles/node_modules` 下那份。

---

## 怎么确认装对了

```bash
cd <profiles>/node_modules/dsh-minimax-h3

# 技能内容是否包含新章节
grep -c "别让模型即兴说话\|ABSOLUTELY NO CUT\|生成后的验收" lib/skill.js
# 期望：>= 3

# 帧数规则是否已纠正
grep -n "5 (mod 17)" lib/workflows.js
# 期望：能匹配到

# 工具渲染签名是否已修
grep -n "function renderText(_args" lib/tools.js
# 期望：能匹配到
```

然后在 DSH 里问一句"MiniMax H3 的合法帧数是多少"——
技能生效的话，回答应该是 **≡ 5 (mod 17)**，而不是 `4n+1`。

---

## 回滚

```bash
cd <profiles>/node_modules
rm -rf dsh-minimax-h3
mv dsh-minimax-h3.bak-YYYYMMDD dsh-minimax-h3
```

---

## 说明

- 这个包是**从本机运行中的副本**打包的（即实际生效的那份），不是从 `/opt` 的原始版。
- 不含 `.bak` 备份文件与任何日志。
- 只改了 JS 与 Markdown，**没有改 `package.json` 的版本号**，所以在 DSH 里看到的版本号仍是官方的。
  升级官方版本时，请重新按上面的 diff 复现这五处改动，或直接把本包再覆盖一次。
