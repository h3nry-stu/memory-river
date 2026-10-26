# 溯光 · Memory River

照片化成粒子汇入宇宙中的光河。每一张图是一个 AI 记忆分身，所有分身共享同一个总人格「溯」。

> **当前状态：阶段 1–5 已完成** —— 深空光河 / 照片粒子重组 / MediaPipe 手势全链路均已真机验收通过。
> 阶段 4：**切片人格 + 跨图记忆 + 玻璃电影字幕 + 真实 LLM + TTS 朗读**（Mock 仅开发探针）。
> 阶段 5：**照片绑定音乐（L2 循环 / 淡入淡出）+ 三频段驱动粒子 + 手势音效 + 设置/音量**。
> 阶段计划见 [`docs/PLAN.md`](./docs/PLAN.md)，已确认的设定见 [`docs/DECISIONS.md`](./docs/DECISIONS.md)。

> **线上体验**：<https://h3nry-stu.github.io/memory-river/>  
> **GitHub**：<https://github.com/h3nry-stu/memory-river>  
> 这是本地优先的 Web 应用，线上可体验视觉、手势和音乐；聊天/识图需要自己的 API Key。

## 下载与运行（macOS / Windows）

### 你需要

- Node.js **22 或更高版本**
- Git（也可以直接在 GitHub 页面点 `Code → Download ZIP`）
- Chrome / Edge / Safari 的较新版本
- 摄像头可选；没有摄像头可以按 `G` 用鼠标和键盘体验
- 首次安装需要联网下载约 **33MB** 手势模型与 wasm

> **不要直接双击 `dist/index.html`。**  
> 摄像头、ES Module 和本地资源都需要通过 `http://localhost` 启动。

### 第 1 步：下载项目

```bash
git clone https://github.com/h3nry-stu/memory-river.git
cd memory-river
```

没有 Git 的话，在 GitHub 页面点击：

```text
Code → Download ZIP → 解压 → 进入 memory-river 文件夹
```

### 第 2 步：安装 Node.js 22+

macOS：

```bash
brew install node@22
node -v
```

或者从 <https://nodejs.org/> 下载 macOS 安装包。

Windows：

1. 打开 <https://nodejs.org/>
2. 下载并安装 **Node.js 22 LTS**
3. 重新打开 PowerShell，确认：
   ```powershell
   node -v
   ```

### 第 3 步：安装依赖

macOS 终端 / Windows PowerShell：

```bash
corepack enable
corepack pnpm install
```

如果提示 `corepack` 不存在或权限不足，用 npm 兜底：

```bash
npm install -g pnpm
pnpm install
```

第一次安装会自动准备 MediaPipe 手势资产。下载失败不会阻塞启动：运行时会尝试 CDN，鼠标模式始终可用。

### 第 4 步：启动

```bash
corepack pnpm dev
```

或者：

```bash
pnpm dev
```

浏览器打开：

```text
http://localhost:5273
```

如果 5273 被占用：

```bash
pnpm dev --port 5274
```

### 第 5 步：允许摄像头（可选）

macOS：

```text
系统设置 → 隐私与安全性 → 摄像头 → 允许你的浏览器
```

Windows：

```text
设置 → 隐私和安全性 → 摄像头 → 允许桌面应用访问摄像头
```

浏览器地址栏左侧也可以单独允许摄像头。摄像头被拒绝时会自动切到鼠标模式，按 `G` 也可以手动切换。

### 第 6 步：配置 AI Key（可选）

不填 Key 也能体验：

- 深空光河
- 照片导入与粒子重组
- 手势 / 鼠标缩放、切照片
- 照片配乐
- 开场动画

聊天和照片识图需要你自己的 API Key：

1. 打开右上角齿轮
2. `AI 服务商` 选择 `DeepSeek`
3. 填入你的 DeepSeek Key
4. 保存
5. 如需照片识图：`05 视觉模型 (VLM)` → `DeepSeek` → `deepseek-flash`
6. VLM Key 可以留空：VLM 与聊天使用同一个 Base URL 时，会自动复用聊天 Key

Key 只保存在你浏览器的 `localStorage` 里，不会提交到仓库。仓库中没有任何站点 Key。

### 3 分钟体验流程

1. 打开页面，等待开场动画结束
2. 把 2–3 张照片拖进窗口，或点右下角「导入照片」
3. 把手放进摄像头画面；懒得用手就按 `G`
4. **扇手腕**：切照片
5. **手静止时张开/合拢**：拉近/推远
6. **捏合**：进入当前照片
7. 在 L2 和「溯」聊两句
8. 底部右侧可以给照片绑定一首本地音乐

### 常见问题

| 问题 | 处理 |
| --- | --- |
| `pnpm: command not found` | 先执行 `corepack enable`；还不行就 `npm install -g pnpm`，然后重开终端 |
| `corepack` 权限错误 | 用 `npm install -g pnpm` 兜底，或使用管理员终端 |
| 页面打不开 | 确认 `pnpm dev` 还在运行；看终端里的实际端口 |
| 5273 被占用 | `pnpm dev --port 5274` |
| 摄像头黑屏 | 检查系统/浏览器摄像头权限；关闭占用摄像头的会议软件；刷新页面 |
| 摄像头不可用 | 按 `G` 切鼠标模式；没有摄像头也能完整操作 |
| 黑屏 / WebGL 报错 | 用最新 Chrome/Edge；开启浏览器硬件加速；更新显卡驱动 |
| 首次安装很慢 | 正在下载约 33MB 手势资产；下次启动会复用 |
| 照片刷新后消失 | 当前版本照片只存在内存里，这是已知限制 |
| API 401 | 检查 Key、Base URL 和模型名是否匹配 |
| 智谱 VLM 报 CORS | 智谱接口可能不允许浏览器直连；建议用 DeepSeek `deepseek-flash` |
| 听不到朗读 | TTS 默认关闭；在设置 → 语音里打开并选择音色 |

### 当前限制

- 照片、聊天、配乐只存在内存里，**刷新页面会清空**
- 没有账号、没有云端同步、没有数据库
- 访客自带 Key，不提供站点统一额度
- 摄像头手势依赖浏览器 WebGL / MediaPipe，低端设备会自动降 LOD
- 首次运行需要联网准备手势资产

## 开发命令

```bash
corepack pnpm install     # 安装依赖，并准备 public/mediapipe 资产
corepack pnpm dev         # http://localhost:5273
corepack pnpm build       # tsc -b && vite build
corepack pnpm typecheck   # 只做类型检查
```

打开后应当看到：深空渐变 + 星尘 + 一条**横向蜿蜒的 3D 中空螺旋星管**横贯画面正中——
主轴走 2 个完整 S 形波长，粒子沿 Frenet 框架在轴线周围螺旋缠绕成管壁、管心中空通透，
背面更暗更冷、正面更亮更大，从左端淡入、向右端淡出。没有地面透视感，是纯粹悬浮在宇宙里的星河。
**L0/L1 只看得见情绪粒子，照片只在 L2 由粒子重组出现。**
颜色沿时间轴分成段落（暖金 / 青白 / 冷蓝）。**点击或拖动丝带会漾开涟漪**（正对镜头扩散，粒子被波前顶起来）。
右上角有实时遥测：fps / LOD 档位 / 粒子数 / bloom 开关。

开发期 URL 参数（仅 DEV 生效）：

| 参数 | 作用 |
| --- | --- |
| `?lod=high\|mid\|low` | 强制 LOD 档位，用来比对画质与性能 |
| `?capture=1&captureDelay=5000` | 把当前帧缓冲导出到 `<pre id="mr-capture">`（无头验证用） |
| `?ripple=1` | 截图前激起三圈涟漪，便于验收涟漪效果 |
| `?diag=1` | 导出运行期诊断：窗口/画布尺寸、相机位姿、粒子包围盒、照片节点、碎裂强度（排查用） |
| `?exposureProbe=1` | **量化照片曝光**：对比「源图片区域」与「渲染帧同区域」的 RGB 均值/最大亮度/溢出比例 |
| `?simMachine=1` | **状态机时间线仿真**（不用摄像头）：按时序喂假帧，输出每个手势事件与触发时刻 |
| `?simCursor=1` | 模拟一只手的实时状态（光标/拖尾/进度环/骨架），没有摄像头也能验收视觉反馈 |
| `?captureOverlay=1` | 把光标覆盖层与骨架 canvas 导出为 base64（配合抓取验收） |
| `?simCalibration=1` | 校准流程仿真（注入时钟）：握拳/张开采样 → 落库 → 映射变化 |
| `?scrollTo=21` | 直接把长河拨到某个世界坐标（验证自动焦点 / 居中精度 / 动态节点窗口） |
| `?scrollSim=-6` | 以给定"屏幕宽度/秒"的初速度拨一下，同步跑完惯性+吸附并输出落点 |
| `?calibDemo=1` | 强制显示"校准已完成"浮层（UI 预览 / 自动化点击验证用） |
| `?hitTest=calib-open,calib-close` | 用 `elementFromPoint` 验证按钮真的能被点到（防止被 `pointer-events:none` 或浮层遮挡） |
| `?demoPhotos=4` | 注入 N 张合成示例照片（无头验证用，等价于手动导入） |
| `?layer=L1\|L2&focus=0` | 直接跳到某一层并聚焦第 N 张（跳过阻尼过渡，仅 DEV） |
| `?demoDetail=1` | 示例照片换成**高频测试靶**（棋盘 + 1px 细线 + 三档小字），用来看照片够不够清晰 |
| `?sweep=1` | **切换照片流畅度**：模拟连续扇动并统计每帧工作量（`#mr-sweep`） |
| `?chatSim=1` | **对话与跨图记忆端到端仿真**：3 张切片 → 在 A 说难过 → 切到 B 说累 → 看 B 是否引用 A（`#mr-chatsim`，DEV 显式走 Mock） |
| `?chatPanel=1&chatUi=1` | **真 UI 链路**：滑出面板 → 在输入框打字 → 点发送 → 回复进气泡（`#mr-chatpanel`） |

## 开场 Splash

- 首屏纯黑暗场居中显示「溯光」2 秒
- 副标题：`Memory River · 拨动星辰，打捞过去的时间`
- 再用 1.5 秒淡出，露出背后的粒子长河
- 整层 `pointer-events: none`，从不拦截鼠标/手势
- DEV 探针参数会跳过 Splash；也可以手动 `?splash=0`

## 设置与配置（2026-10 接手重构）

右上角齿轮打开玻璃拟态设置面板，所有配置存在本机 `localStorage`：

| 配置 | 说明 |
| --- | --- |
| `AI 服务商` | DeepSeek / OpenAI / Kimi / 通义千问 / 智谱 / SiliconFlow / Ollama / 自定义 |
| `LLM 模型` | 按服务商提供可选模型，也可以直接手填任意兼容模型名 |
| `Base URL` | 选择服务商后自动填充，仍可修改（支持任意 OpenAI 兼容端点） |
| `API Key` | 用户自己填，保存在 localStorage；下载运行时不需要 `.env` |
| `AI 人格` | 温柔老友 / 幽默损友 / 赛博向导 / 树洞倾听者，只影响气质，不限制输出 |
| `语音` | 默认静音；打开后可选系统中文音色（婷婷 / 美佳 / 晓晓…）并试听；也可填第三方 `/audio/speech` Base URL + Key |
| `视觉模型 (VLM)` | 独立服务商 + 视觉模型下拉；DeepSeek `deepseek-flash` 支持浏览器直连；高清 / 自动识图 |
| `人格语料蒸馏` | 4 个人格各自的多行语料 + 上传截图 OCR + 一键生成人格指令 |
| `热梗截图识别` | 拖拽 / 点击 / 粘贴截图，支持一次多张 → 串行识别 → 去重合并热梗库 |

聊天不再静默回落 Mock：**无 Key / Key 无效 / 离线时输入框直接禁用**，不会伪造 AI 回复。TTS 失败仍静默回落系统音色。Mock 仅保留给开发探针。

### API Key 真实校验

聊天 Key 与 VLM Key 输入后约 800ms 会自动联网校验：

- 绿色 ✓：`GET /models` 通过，或平台不支持时 `max_tokens=1` 的聊天请求通过
- 红色 ✕：401/403、超时、断网或接口异常，悬停可看原因
- 点击图标可手动重试；校验请求不写入聊天/VLM 熔断状态

### 人格蒸馏怎么用

1. 右上角齿轮 → 拉到 `06 人格语料蒸馏`
2. 选一个人格 Tab → 粘贴聊天记录，或点「上传截图（可多选）」一次选多张截图
3. 点「解析并生成人格」→ 蒸馏高频词、情绪节奏、共情逻辑与断句习惯 → 下一次聊天生效
4. 「恢复默认」只清除 instruction，原始语料仍保留，可再次编辑生成

原始语料只保存在本机，用于编辑；**聊天 System Prompt 只读蒸馏后的 instruction**。

### 截图学热梗怎么用

1. 右上角齿轮 → 拉到 `07 热梗截图识别`
2. 把截图拖进虚线框、点击选择文件，或直接 `Ctrl/Cmd + V`
3. VLM 返回 JSON 数组后自动去重入库，并提示「成功学会新梗：…」
4. 幽默损友 + 轻松语境下，最近 8 条热梗会动态注入 System Prompt

### 控制台确认

```js
// 人格原始语料 + 蒸馏结果（instruction 才会进聊天）
JSON.parse(localStorage.getItem('memory-river:persona-profiles:v1'))

// 热梗库
JSON.parse(localStorage.getItem('memory-river:meme-library:v1'))

// 聊天 / VLM 配置
JSON.parse(localStorage.getItem('memory-river:ai-settings:v1'))
```

### 照片 VLM 识图

- 在设置面板 05 选择 VLM 服务商（OpenAI / 通义千问 / GLM / Moonshot / SiliconFlow / Ollama / 自定义）
- 模型从该服务商的视觉模型下拉中选择，Base URL 自动填充
- 默认开启「高清识图」：照片 2800px / JPEG 0.95 / `detail: high`
- 默认开启「导入照片时自动识图」，多张照片串行分析
- 分析完成后，聊天 System Prompt 会优先使用 VLM 的真实描述（场景 / 物体 / 光线 / 画面文字 / 不确定项）
- 没配置 VLM 时，L2 不显示识图入口，也不发请求，继续使用像素统计标签
- 识图失败时可在 L2 点「识图失败 · 重试」；会自动尝试小图 / 去掉 detail 的三档兼容
- VLM 与聊天服务商不同时必须单独填 VLM Key，否则设置面板会警告（避免 401）
- 截图 OCR / 学热梗使用 2400px PNG，过大时自动降级 JPEG

### AI 连发多条消息

- 人格蒸馏会从语料里学习断句与连发习惯
- 聊天模型用 `<<<MSG>>>` 分隔多条消息
- UI 会把一轮回复拆成多条玻璃气泡，间隔约 300ms 依次浮现
- `turn.text` 保持完整回复，用于记忆/检索/TTS
- `turn.bubbles` 只用于显示；分隔符不会进入记忆
- 单句回复仍然是单气泡；没有分隔符时安全回退单气泡
- TTS 默认关闭；打开后在最后一条气泡出现时朗读，可随时关闭

### 照片配乐（L2）

- 进入某张照片的 L2 → 底部右侧「配乐」胶囊 → 选择本地音频或粘贴音频 URL
- 一张照片只能有一首；重新绑定会覆盖
- L2 循环播放，进入淡入 1.8s，退回 L1/L0 淡出 1.2s
- 切照片时旧曲先淡出并停止，再淡入新曲，不会两三首叠在一起
- 没有绑定音频的照片保持静音（不再播放程序化低频宇宙音）
- 低频驱动长河波幅、亮度与 bloom；DJ/鼓点重的歌最明显
- DEV 控制台可看：`window.__MR_MUSIC.debugState()`

手势方面：**L2 捏合锁定界面**（锁定后忽略扇风、静止缩放和握拳退出；再捏合解锁；鼠标/键盘仍可用）。
锁定状态下离开 L2 会自动解锁；食指光标与拖尾已移除，只保留当前照片焦点环与张开度指示。

**握拳保持 360ms 是最高优先级**（L2 锁定时除外），任何层级（包括聊天中）都会直接回到 L0 并收起对话；
聊天气泡使用玻璃字幕，所有控件层级高于画布，不会出现点击穿透。

## 阶段 3 怎么测（手势）

1. `pnpm dev` → 打开 http://127.0.0.1:5273 ，浏览器会请求摄像头权限（localhost 即可，不需要 HTTPS）
2. 把手放进画面：**左上角手势卡片**出现绿色发光骨架，上方文字变成「状态：张开手掌」
3. 进入 L2 后卡片会自动收成左上角小状态胶囊，点击可临时展开；主画面不再显示食指光标/拖尾
4. 只有三个动作（2026-10 极简版）：

   > 摄像头画中画手动收起后会保持胶囊：切层、调整窗口、刷新页面都不会自动展开，点胶囊才展开。

   | 动作 | 期望 |
   | --- | --- |
   | **手腕左右扇一下**（像扇扇子/挥手拜拜） | 长河滚一段 → 惯性 → 磁吸到最近的照片居中 |
   | **扇动过程中** | **绝不缩放/切层**（320ms 内缩放被冻结） |
   | **手停住不动 + 张/合手掌** | 张开放大、握拳缩小（手一动就不缩放） |
   | **拇指食指捏合** | 进入当前居中的照片（L2） |
   | **张开后快速握一下拳**（<0.42 秒） | 同样进入当前照片 |
   | **慢慢握拳**（>0.42 秒） | 只缩小，不进入 |
   | 手短暂飞出画面（< 1 秒） | 不闪断：光标与缩放都保留 |

   旧的"手掌平移跟随 / 张开度阈值切层 / 300ms 复位 / 500ms 缩小 / 缓冲带 / 停留自动进入"
   **全部删除**。

   细节说明（`?simMachine=1` 可复验）：
   | 动作 | 期望 |
   | --- | --- |
   | 张开手掌（>0.35）左右平移 | 长河跟着滚动，**离画面正中心最近的那张自动变成焦点**（虚线环高亮） |
   | 停手 | 先惯性滑行，再**自动吸附**，选中的照片精准停在正中间 |
   | 手慢慢张开（静止时） | 河**连续**被拉近（L0→L1） |
   | 手慢慢合拢（静止时） | 河连续被推远（L1→L0） |
   | **拨动过程中张开手** | **只滚河，不切层**（缩放被冻结，260ms 后才恢复） |
   | 拇指食指捏合 | **进入 L2**（L1→L2 的唯一"快速"通道） |
   | 张开 → 突然握拳 | 进入当前焦点（`GESTURE.fistEnter`，握拳期间画面锁在 L2） |
   | L1 张到极限并静止 4 秒 | 缓慢推进到 L2（后路，绝不会手一张就切） |
   | 食指光标 | **只做视觉引导**，不再负责拾取照片 |
   | 手短暂飞出画面（< 1 秒） | 不闪断：光标与缩放都保留 |
   | 手离开超过 1 秒 | 光标淡出，提示「看不到手了 · 可点击鼠标继续」 |
5. 按 `G` 随时切到鼠标模式（滚轮缩放 / 拖拽漫游 / 点击进入 / 悬停高亮），路演兜底
6. 摄像头被拒或没有摄像头时，会自动切到鼠标模式并给出提示

**没有摄像头也能验**：
`?simMachine=1`（连续映射与捏合冻结）、`?simCursor=1`（光标与骨架视觉）、`?simCalibration=1`（校准流程）

### 切照片顺不顺？用数字验，不靠肉眼

「扇动时卡一下」以前是**每帧同步重建照片节点**（`getImageData` 回读 + 3.6 万次采样 + 上传缓冲）。
现在改成"缓存 + 预建 + 每帧最多建 1 个 + 焦点外不画"，验证方式是一条 URL：

```
http://127.0.0.1:5273/?sweep=1&demoPhotos=12&lod=high&captureDelay=4000
```

页面右下角会注入 `<pre id="mr-sweep">`（也可以在 DevTools 里 `document.getElementById('mr-sweep').textContent`）：

| 字段 | 合格线 | 含义 |
| --- | --- | --- |
| `warm.maxBuildsPerFrame` | **≤ 1** | 最糟的一帧也只新建 1 个节点 —— 不会出现"整批重建"的掉帧 |
| `steady.maxBuildsPerFrame` | **≤ 1** | 回程也一样 |
| `photos.sampled` | **= 15000 × 张数**（12 张 → 180000） | 每张照片**只采样一次**；数值翻倍就说明缓存没命中 |
| `photos.cacheMisses` | ≤ 张数 | 采样次数 |
| `photos.pending` | 0 | 没有排队没建完的节点 |
| `warm.max` / `steady.max` | 真机上 < 16.7ms | 墙钟耗时（无头环境的虚拟时间不推进同步代码，所以是 0，属正常） |

真机上还可以看 HUD 的 `fps`：L1/L2 边扇边看，应该稳定不掉到 40 以下。

### 手型不对？先看数字，再校准

1. 展开左上角手势卡片，卡片内实时显示 **`open 0.52`** + `ratio 1.85` + `扇` + `捏` 数值。
2. 你**完全张开**手掌时如果 `open` 到不了 0.75 以上，点画中画下方的 **「校准手势」**：
   - 屏幕提示「请完全握拳，保持 3 秒」→ 照做
   - 再提示「请完全张开手掌，保持 3 秒」→ 照做
   - 完成后显示「校准完成：1.24 → 1.86」，区间存进 localStorage，之后都按这只手算
3. 校准结果可以点「重置」恢复默认。

## 阶段 4 怎么测（沉浸式对话 / 记忆 / 人格）

### 30 秒手动跑通

1. `pnpm dev` → http://127.0.0.1:5273 ，拖进 **2–3 张照片**
2. **捏合 / 快速握拳**进 L2 → 照片放大、略微上移，背景压黑，照片核心实、边缘星尘
3. 台词是**半透明悬浮字**（电影字幕，没有气泡没有面板）：溯在左、你在右，越旧越淡
4. 底部是**苹果玻璃拟态**：渐变细描边（上亮下暗的高光边缘）+ `bg-white/10` + `backdrop-blur-2xl`
   + 内侧顶部高光 + 细腻深投影。三样东西：
   - **玻璃输入框**（回车发送，聚焦变宽）
   - **按住说话**（或按住空格），说话时上方浮出一条玻璃语音条显示实时文字
   - 玻璃圆钮 **×**
   - 扇风换记忆、静止张合缩放**全程有效**，包括聊天时（见下面 §手势）
   - 短按说话没识别到内容 → 自动把光标放进输入框并提示"没听清，直接打字吧"

### 手势：聊天时也必须绝对生效

| 动作 | 期望 | 验收 |
| --- | --- | --- |
| **握拳（任何状态，含聊天中）** | **最高优先级**（`GESTURE.fistExit.enabled = true`）：保持 360ms 无条件退回 L0，对话同时收起 | 聊天中握拳 → `layer = L0` |
| 静止**握拳**（聊天中） | 缩回、对话收起 —— **不会被"确认锁定"挡住** | `?gestureChat=1` → `zoomWhileChatting.target = 0` |
| 静止**张手**（聊天中） | 放回 L2 | → `zoomBackWhileChatting.target = 2` |
| **扇手腕**（聊天中） | 换下一张记忆，对话跟着换 | → `flickWorksWhileChatting: true` |

**握拳退出现在是最高优先级的硬规则**（不依赖"手静止"、不依赖层级分带、不依赖是否在聊天）：

| 规则 | 值 | 说明 |
| --- | --- | --- |
| 保持握拳多久算退出 | `GESTURE.fistExit.holdMs = 360ms` | 比"快速握一下"的 420ms 短，但快速握拳只在进入 L2 前触发 |
| 进入 L2 后的闩锁 | `afterEnterLatchMs = 300ms` | 300ms 消抖；真正防止同一拳反复触发靠"必须先张开一次" |
| 退出目标 | `fistExit.target = 0` | 直接回长河全景，并关闭对话 |

另外 `progressForBand('L1')` 仍锁死 1（**L1 拨照片时张开手不切层**）；握拳退出来自独立的最高优先级规则，
不依赖分带映射。

修法：`LayerRig.setProgressTarget` 的确认锁定**只作用于"想更近"**；
删掉了 Stage 里"握拳就每帧续锁 L2"的规则；`stageBridge.zoom / swipe` 不再因为对话打开而 return。

**扇风滑动必须和缩放完全解耦**：`stageBridge.zoom` 是**每帧**被手势引擎调用一次的，
所以它里面不能有任何副作用。曾经在里面加过"顺手停住残留滚动"（`scrollVel = 0`），
结果每一记扇风的惯性都在下一帧被清零 —— 滑动直接失灵。现在这条路径只做一件事：
把目标交给 rig。

**L1↔L2 扩大缩小的抖动**（真机反馈）——根因是**目标被来回拉锯**：
渲染循环把连续进度派生成离散层写回 `store.layer`，而订阅一看到 L2 就 `holdProgress(2,1300)`
把目标钉在 2；手稍微收回又变 L1 把目标拉回 1。三处一起修：

| 问题 | 修法 |
| --- | --- |
| 派生层级反过来驱动 rig | 加 `derivedLayerSync` 标记，派生的层变化只用于 HUD，**不再触碰 rig** |
| 阻尼在 `|目标-当前| > 0.35` 处硬切换（正好在 L1→L2 中间，刚度突变 4 倍） | 改成按距离平滑过渡（`smoothstep 0.12→0.55`） |
| 张开推 L2 时照片横向漂 / 竖向上移 | 横向回中门槛 1.3→1.75、让位上移门槛 1.35→1.9 |

验收 `?zoomSweep=1`：`L1→L2 / L2→L1 / L0→L2` 三趟全部 `maxStep < 0.05`、`reversals: 0`、`driftX: 0`，
且 `derivedLayerKeepsTarget: { target: 1.6 }`（派生层级不再把目标拉走）。

### 话术（铁律 + 网感）

| 规矩 | 落地 | 验收 |
| --- | --- | --- |
| 安静、禁说教、禁客服腔、可说"我记不清了" | `guard.ts` 删建议/客服/抽象情绪句 | `allNoAdvice` |
| **单句 ≤ 15 字**、陈述:提问 3:1、不连续追问 | `sentenceMaxChars 15` + `clampSentences` | `allShortSentences` / `statementToQuestion` |
| **禁止"我记得的/我记忆里"这类废话** | 词库已清理 | `noFiller` |
| 说画面里**看得见**的具体东西 | 视觉锚点 → 台词 | `allConcrete` |
| **不要模板感、不要捧哏** | 每轮随机挑"形状"（朋友式反应 / 反应+画面 / 反应+梗 / 只说画面 / 跨图 / 回声），**没有"嗯。"这种必选前缀** | 连跑 `?toneCheck=1` 节奏都不同 |
| 像朋友一样吐槽/接话 | `AI.mock.voice.react`（按情绪给有态度的话：`那就瘫着。` `别硬撑。` `沉就沉吧。`） | 见下方实测 |
| **网感**：轻松语境抛热梗（奶龙 / 这瓜保熟吗 / 尊嘟假嘟），情绪低落时**绝不**用 | `AI.mock.memes`（`chance` 0.62 / 冷却 2 条 / `avoidEmotions`） | `memeCount ≥ 1` |
| 跨图**不背板** | 「另一张你也这样。」「上次也是这个。」 | `crossImageCited` |

实测（同一组输入，连跑三次，节奏都不一样）：

```
今天好累            → 别硬撑。有人。  /  先躺平。像在室内。
那天其实挺难过的。  → 不用说话也行。  /  沉就沉吧。有人。
你好                → 这人看着像奶龙。  /  这人，尊嘟假嘟。
你也难过（换过图）  → 沉就沉吧。没有很亮的地方。
这是哪儿？          → 屋里。光很平。
你还记得那天那个大门吗？ → 看不清门。像在室内。   ← 认不出绝不顺着编
```

没有一句以「嗯。」开头，也没有"我记得的 / 在我的记忆里"这类废话。

**热梗只在轻松语境出现**：用户说"难过 / 累 / 怕 / 孤单"时一定不会抛梗（这是之前的 bug：第一轮没有跨图数据时误判成轻松）。

### 识图：视觉锚点（严禁瞎编）

导入时对图片做像素统计（`src/photo/vision.ts`，64×64，几毫秒），只在**证据够硬**时报锚点：

| 锚点 | 判据 | 台词 |
| --- | --- | --- |
| 人 | 肤色占比 > 6% | 有人。 |
| 树 | 绿色占比 > 16%（> 30% 说"树很多"） | 有树。 |
| 天空 | 上方明显更亮 + 有蓝 | 上方是天空。 |
| 水面 | 蓝青 > 32% 且细节少 | 有水。 |
| 夜景 | 暗 + 有亮点 | 像是夜里拍的。 |
| 暖光 | 暖色 + 亮点 | 有暖光。 |
| 墙 | 细节少 + 低饱和 | 大面是墙。 |
| 室内 | 绿很少 + 偏暖或偏暗 | 像在室内。 |
| 街景 | 细节多 | 像在街边。 |

**一个锚点都没有时**：不编景物，开场白就是「看不出这是哪儿。」，问「记得那扇门吗」就答「看不清门。」
切片的"地点/城市"也只由锚点推出来（认不出就没有地点）。阈值全在 `PHOTO.visual.anchors`。

### 跨图记忆

按 `photoId` 归档；切图时检索**别的切片**的对话（中文二元组 + 情绪 + 城市标签）。
命中时只用一句自然的短句带过（**不说"你刚才说过"**），具体哪张图交给那枚**记忆碎片**标签。

### 用数字验

| URL | `<pre>` | 合格线 |
| --- | --- | --- |
| `?toneCheck=1&demoPhotos=2&demoDetail=1` | `#mr-tonecheck` | `allShortSentences/allShortTotal/allNoAdvice/allConcrete/noFiller/guardStable` 全 true，`memeCount ≥ 1`，`crossImageCited: true` |
| `?gestureChat=1&demoPhotos=3` | `#mr-gesturechat` | `zoomWhileChatting.target: 0`、`zoomBackWhileChatting.target: 2`、`flickWorksWhileChatting: true` |
| `?zoomSweep=1&demoPhotos=3` | `#mr-zoomsweep` | `allPass: true`；三趟 `maxStep < 0.1`、`reversals: 0`、`driftX < 0.2`；`derivedLayerOk: true` |
| `?aiCheck=1&demoPhotos=2` | `#mr-aicheck` | `source: "remote"`（真实模型已接上）；`runtime.hasKey: true`；`reply` 非空 |
| `?flickCheck=1&demoPhotos=5` | `#mr-flickcheck` | `allPass: true`；`distances` 应为 `[1, 3, 3]`（轻扇 1 张、正常 3 张、猛扇封顶 3 张）——它按真实顺序逐帧先 `zoom()` 再 `updateScroll()`，专钉"缩放杀掉惯性"的 bug |
| `?chatPanel=1&chatUi=1&demoPhotos=3` | `#mr-chatpanel` | `hitTargets` 三个全 `clickable: true`、`dom.speechClearsBar: true`、`overflowX: 0` |
| `?chatSim=1&demoPhotos=4` | `#mr-chatsim` | `crossReferenceWorked: true`，`noFabricatedMeta: true`（不再编城市/年份） |

### 真实模型与 Key（访客自带）

仓库里没有站点 Key。运行后在右上角设置里填自己的 DeepSeek Key 即可：

```text
AI 服务商：DeepSeek
Base URL：https://api.deepseek.com/v1
模型：deepseek-chat
API Key：你自己的 Key
```

- 不填 Key：光河、照片、手势、音乐都能用；聊天和识图入口禁用
- 没有 Key / 断网 / 超时 / 401 → **不回复、不回落 Mock**
- `?toneCheck=1` / `?chatSim=1` 等开发探针可以显式使用 Mock
- 开发时也可以在本地 `.env` 里填 `VITE_DEEPSEEK_API_KEY` 作为兜底；`.env` 已在 `.gitignore` 中
- **不要把真实 Key 提交到 GitHub**，也不要把带 Key 的 `dist` 上传

真实模型下，照片元信息以**真实文件名为准**；系统没拿到 EXIF / 用户输入时，模型会直接说不知道时间地点：

```
我: 这是什么时候拍的？
溯: 这张没有拍摄时间信息，我记不清具体是哪天。
我: 我住在哪来着
溯: 你没告诉过我，我不知道你住在哪。
```

真实模型下，跨图记忆仍然自然发生（引用的标签是另一张照片的真实文件名）。

## 阶段 2 怎么测（1 分钟跑通）

1. `pnpm dev` → 打开 http://127.0.0.1:5273
2. **导入**：把 3–5 张图片直接拖进窗口（或点右下角「导入照片」）；底栏出现缩略图，每张带一条情绪色条
3. **L0 → L1**：滚轮向上（或按 ↑ / W）一次 → 相机拉近成中景，河里浮出几张可辨认的照片节点
4. **L1 → L2**：再滚一次 → 聚焦的那张照片放大到占视口 72%，周围粒子退后变暗、照片周围清场
5. **锁定**：在 L2 继续滚轮 → 只有很轻的过冲，然后弹回（不会无限放大）
6. **退回**：滚轮向下 / ↓ / Esc → 照片**从斑块开始碎裂**：贴图被打洞、颗粒逐颗剥落飞散，最后化回长河。
   碎裂强度跟"缩放速度"挂钩：滚得越快炸得越彻底，停手后会重新聚拢（所以慢慢滚能看到碎的中间态）
7. **换一张**：点缩略图或直接点画面里的照片平面；`Enter` 聚焦离画面中心最近的一张

> 缩略图条的排列**不是导入顺序**，而是沿长河从左到右（暖 → 冷）的顺序，
> 这样缩略图顺序 = 河里照片的左右顺序，找起来更直观。
> 如果连续多次导入，时间轴会自动重排，相机焦点会跟着一起走（节点会重建，不会错位）。

## 阶段 1 实现要点

- **一切逐粒子的计算都在 GPU**：`aSlot` 一个属性 + `uTime` 一个 uniform，顶点着色器算出流动、弯曲、水面 swell、侧向摆动、涟漪位移、情绪取色、闪烁。CPU 每帧只更新 4 个涟漪槽位和相机。
- **横向蜿蜒**：`X` = 时间主轴（`slot 0` 左端起点 → `slot 1` 右端终点），`Y` = 主起伏 + 二次谐波（S 形），`Z` = 纵深蜿蜒。坐标换算集中在 `particles/riverPath.ts`。
- **没有地面透视**：相机正视丝带、长焦压缩，取景距离按视口比例自动解算（`RIVER.camera.widthFill`），任何屏幕比例下都横向撑满、垂直居中。
- **两个完整波浪**：`RIVER.wave.freq = 0.45`，横贯屏幕走出 2 个波长（连绵 W 形）；振幅 2.1 保证加厚后的光带不碰上下边缘
  （实测包围盒 `y ∈ [-6.4, 6.2]`，可见半高 8.0）。
- **3D 中空螺旋管**：粒子不贴在平面上，而是用 Frenet 框架（`riverPath.frameAtX`，shader 里用解析切线同式）
  分布在圆柱面上；角向相位把粒子聚成 `strands` 股并随 x 扭转 → DNA 双螺旋/时光隧道感；`hollowRatio` 保证管心中空。
- **所有粒子都贴着管壁**：半径是**有界**的（`hollowRatio..1`，仅 16% 的飘散尘埃到 1.55×），
  早期无界高斯会把尾巴粒子甩到 ±20 世界单位外，变成与长河无关的散点 —— 已修，`?diag=1` 可核对包围盒（现在 y ∈ ±5.9、z ∈ [-4.7, 6.1]）。
- **开发期拒绝热替换残留**：`scene/*`、`particles/*` 持有 WebGL 资源与相机状态，改动时强制整页刷新，
  避免出现「新几何 + 旧相机」的错位画面。
- **照片 = 高斯泼溅点云（不是贴图）**：每张照片 3.6 万枚半透明柔光斑，靠**alpha 合成**堆出画面。
  - 用 alpha 而不是加法是关键：加法混合无法遮挡背后的长河，蓝色星光会一直透上来，画面发灰发蓝
    （实测蓝通道 +27）；换成 alpha 合成后收敛到照片本身的颜色（源 (138,134,66) → 渲染 (139,137,68)）。
  - 贴图只留 0.14 的薄底，用来兜住"这确实是那张照片"的辨识度，不再承担画面亮度。
- **径向重组**：每颗粒子按 `aRadial`（离画面中心的归一化距离）分配凝实阈值，
  所以 `assemble` 上升时是**从正中心向外扩散**的波纹；`radial.spread > 1` 时最外圈永远留一点漂浮。
- **边缘飞散**：未凝实的粒子沿"它在河里的散落位置"推开，`edgeScatter` 让边缘飞得最远 → 与长河融合，没有硬边框。
- **照片层整体在 overlay 场景**（bloom 之后、色调映射之前叠加）：照片必须忠实，不能被辉光糊成一片白。
  实测 `?exposureProbe=1`：源图均值 (138,134,66) → 渲染 (139,137,68)，最高亮度 184 → 191，零溢出。
- **LOD 亮度补偿只作用于粒子**：低画质档的 `exposureBoost` 以前会改全局 `toneMappingExposure`，
  把照片一起推亮（实测 +18/通道）。现在只乘进 `river.setBrightness()`，照片在任何档位都一致。
- **两端淡入淡出**（`RIVER.endFade`）+ **断面边缘变暗**（`RIVER.edgeFade`）：隐藏环绕跳变，同时让边缘看起来是散开的尘埃。
- **「光」而不是「沙」**：粒子亮度分级（`PARTICLE.intensity.energy*`，极少数亮核越过 1.0 被 bloom 拾取成光晕），配合 4 层拖尾采样把点拉成光丝。
- **LOD 三档**：GPU 字符串 / 核心数 / 内存 / UA 判定初始档，运行期按 FPS 换档（带迟滞）。降档只改 `drawRange` 与像素比，不重建 buffer；关掉 bloom 的档位会补偿亮度与曝光。

## 技术栈

| 用途 | 选型 | 说明 |
| --- | --- | --- |
| 构建 | Vite 8（rolldown）+ React 19 + TS 5.9 | `tsc -b` 项目引用，strict + noUncheckedIndexedAccess |
| 样式 | Tailwind v4（`@tailwindcss/vite`） | 只在 UI 叠层用 utility；视觉参数不写在 class 里 |
| 3D | Three.js r186 | 手写渲染循环 + 自定义 GLSL；后处理用官方 EffectComposer / UnrealBloomPass |
| 手势 | `@mediapipe/tasks-vision` 1.1.1 HandLandmarker | wasm + 模型已本地化，离线可跑（阶段 2 接入） |
| 状态 | zustand 5 | 单一 store，scene/gesture/ui 都只读它 |
| 音频 | Web Audio + FFT | 照片绑定音乐；无配乐时静音；三频段驱动粒子 |

## 目录结构

```
src/
├── config.ts          ★ 唯一真源：阈值/时长/颜色/预算/文案（13 个分区，全部 deepFreeze）
├── scene/             Stage / cosmos / postfx / lod
├── particles/         river（光河）/ starfield / ripples / emotion / riverPath
├── shaders/           cosmos、river、ripple 的 GLSL（?raw 导入）
├── gesture/           tracker（MediaPipe）/ features / stateMachine / engine / liveState
├── state/             zustand store（层级/输入/悬停/遥测/**对话归档**）
├── ai/                阶段 4：slices 切片人格 / prompt 组装 / retrieval 跨图检索 /
│                      mock 规则回复 / runtime DeepSeek 适配 / guard 护栏 / tts 朗读 / chat 控制流
├── memory/            切片 / 归档 / 人物志 / 检索的类型契约
├── music/             engine 照片音乐 / analyser FFT / sfx 手势音效
├── ui/                React 叠层（HUD → 取景框 → 对话）
├── dev/               captureProbe：从应用内部导出真实帧缓冲
└── styles/            Tailwind 入口与 @theme 令牌
```

## 配置契约（重要）

`src/config.ts` 是**唯一**允许出现数字常量的地方：

`PALETTE` `LAYERS` `GESTURE_PRIORITY` `GESTURE` `PARTICLE` `RIVER` `RIPPLE` `MUSIC` `AI` `MEMORY` `INPUT` `PERF` `UI_COPY` `TIMELINE` `VISION`

- 全部 `deepFreeze`，运行期不可改写；聚合对象 `CONFIG` 供调参面板 / 单测断言
- 颜色：canvas 读 `PALETTE`，UI 读 `styles/index.css` 的 `@theme`（两者需同步）
- 文案：`UI_COPY.forbiddenCopy` 列出禁用说法，阶段 2 起可用断言守住

### 调参速查（阶段 1）

| 想改什么 | 去哪儿 |
| --- | --- |
| 波浪数量 | `RIVER.wave.freq`：波长数 ≈ `spanWidth × freq / 2π`（当前 0.45 → 2 个完整波长） |
| 起伏幅度 | `RIVER.wave.amp`（2.1）+ 二次谐波 `amp2`；加厚光带后仍留出上下边距 |
| 横向长度 | `RIVER.spanWidth`（配合 `camera.widthFill` 决定画面占比） |
| 光带粗细 / 尘埃散度 | `RIVER.ribbon`（`thicknessY` 2.0 / `thicknessZ` 2.4 / `coreMaxCross` 1.05 / `haloMaxCross` 2.0 / `haloDim`） |
| 纵深飘动 | `RIVER.depth` |
| 流动快慢 | `PARTICLE.motion.flowSpeed`（每秒走完的时间主轴比例） |
| 画面太亮/太暗 | `PALETTE.particle.hdrBoost` `PALETTE.glow.bloomStrength/threshold/exposure` |
| 涟漪大小/粗细/手感 | `RIPPLE.*`（`lineWidth` 是相对半径的比例） |
| 照片曝光 | `PHOTO.exposure`（默认 0.9；照片已绕过 bloom，这个值只用来抵消 ACES 的轻微压暗） |
| **照片清晰度（最主要的旋钮）** | `PHOTO.stages.l2.planeOpacity`（0.42：全分辨率贴图占比，越高越锐） |
| 颗粒清晰度 | `PHOTO.splat.worldSize`（0.042）+ `PHOTO.splat.core`（4，核心紧度）+ `sizeJitter`（0.45，越小越锐） |
| 颗粒数量 / 预算 | `PHOTO.particlesPerPhoto`（8 万）/ `PHOTO.totalParticles`（96 万，按张数平摊） |
| 泼溅强度（整体亮度） | `PHOTO.splat.intensity`（0.58；收核/减粒子后要相应提高） |
| 手势连续映射区间 | `GESTURE_CONTINUOUS`（`lowOpenness` 0.22 → L0，`highOpenness` 0.8 → L2） |
| 照片间距 / 同时显示几张 | `PHOTO.spacing`（7 世界单位）/ `PHOTO.visibleRadius` / `PHOTO.maxNodes`（13） |
| 预建几张 / 每帧建几个 | `PHOTO.prefetchRadius`（5，提前备好）/ `PHOTO.buildPerFrame`（1，别调大否则会掉帧） |
| 焦点之外还画几张 | `PHOTO.focusFade`（`l1` 2.4→3.6 / `l2` 1.3→2.1，单位是"张"；超出就完全不画） |
| 拨动手感（惯性/吸附） | `SCROLL`（`velocityGain` / `inertiaDecayPerSec` / `snapStiffness` / `snapDamping` / `snapDelayMs`） |
| 扇风灵敏度 | `GESTURE.flick.velocity`（默认 1.2 屏宽/秒；**画中画里的「扇 xx」就是它**） |
| 扇一下滚几张 | `GESTURE.flick.photosPerSpeed`（1.15）/ `minPhotos` 1 / `maxPhotos` 3.2 |
| 扇风冷却与冻结 | `flick.cooldownMs` 280 / `flick.zoomFreezeMs` 320 |
| "手停住"的阈值 | `GESTURE.flick.stillVelocity`（0.22 屏宽/秒）+ `stillSettleMs` |
| 层内/层间分带 | `GESTURE_CONTINUOUS.bands`（`commitL1At` / `backToL0At` / `l1ToL2HoldMs` / `stillVelocity` / `zoomFreezeAfterSwipeMs`） |
| 握拳进入 | `GESTURE.fistEnter`（`opennessThreshold` / `fromOpenAbove` / `cooldownMs`） |
| 默认手型区间（未校准时） | `GESTURE.openness.ratioRange`（1.22–2.02） |
| 手的灵敏度/死区 | `GESTURE_CONTINUOUS`（`curve` / `deadband` / `damping`） |
| 丢手宽限期 | `GESTURE.lost.graceMs`（默认 1000ms） |
| 确认后锁定 | `PHOTO.focusHoldMs`（默认 1300ms） |
| 从中心凝实的波纹 | `PHOTO.radial.spread`（越大边缘越晚凝实） / `soft`（过渡软度） |
| 边缘飞散程度 | `PHOTO.radial.edgeScatter` / `PHOTO.radial.turbulence` |
| 贴图底子厚度 | `PHOTO.stages.l2.planeOpacity`（0.14 = 几乎全靠粒子） |
| 照片在 L2 的颗粒浓度 | `PHOTO.stages.l2.particleOpacity`（0.12 = 只有一点闪烁） |
| 缩放时的碎裂强度 | `PHOTO.shatter`（`speedGain` 越大越炸，`max` 是上限，`particleBoost` 是碎开时的颗粒亮度） |
| 照片在 L1 的清晰度 | `PHOTO.stages.l1`（`assemble` / `planeOpacity`） |
| 光丝长短 | `PARTICLE.trail.layers[].lagSec` |
| 台词构图（几条/多宽/多淡/漂多少） | `AI.ui.bubbles`（`maxVisible` 5 / `fadeByAge` / `driftXPct` / `bottomInsetPx`） |
| 照片在 L2 上移多少 | `AI.ui.photoLiftVh`（7，视口高度的 7%） |
| 胶囊文案（按住说话/空格/凝聚） | `AI.ui.capsule` |
| 用户基础设定（城市/性格） | `AI.userProfile`（`home` 杭州 / `visited` / `traits`） |
| 克制话术（接住/看不出/推断/问句/跨图） | `AI.mock.voice`（`hold` / `blind` / `inference` / `unsure` / `questions` / `crossRef`） |
| 建议腔过滤 | `src/ai/guard.ts` 的 `ADVICE_PATTERNS`（建议/应该/注意身体…整句删） |
| 视觉标签阈值 | `PHOTO.visual.thresholds`（暗/亮/冷暖/绿/蓝/肤色/高光/暗部/细节） |
| 单句长度上限 | `AI.reply.sentenceMaxChars`（15）+ `AI.reply.hardMaxChars`（45） |
| 记忆碎片图标与闪烁 | `src/styles/index.css` 的 `.memory-shard` / `.shard-core` / `.shard-dot`（时长写在 keyframes 里） |
| 底部按钮层级与间距 | `src/ui/Dialogue.tsx` 的三层结构（主胶囊 / 图标行 / 输入行，`gap-3` 与 `gap-2.5`） |
| L2 背景有多黑 | `Stage` 的 `deep` 系数 + `cosmos.setDim()`；想更黑就把 `1 - 0.985*deep` 往 1 推 |
| 照片边缘星尘消散 | `PHOTO.radial.edgeAlpha`（0.32）/ `edgeDrift`（0.26）/ `edgeFadeStart`（0.78）/ `PHOTO.planeFeatherStart`（0.62） |
| 回复多短 | `AI.reply`（`targetChars` 12–42 / `hardMaxChars` 60 / `maxSentences` 2） |
| 陈述:提问 比例（不连问） | `AI.reply.statementToQuestionRatio`（3）/ `maxConsecutiveQuestions`（1） |
| 口头禅 | `AI.catchphrases` + `AI.mock.catchphraseEvery` |
| 切片的时间/地点/说话风格 | `AI.slices`（`years` / `seasons` / `places[].voice,props,sounds` / `youDetails`） |
| 情绪词表（跨图串联的钩子） | `AI.slices.emotions`（单字词只做标签，不参与意图判定） |
| 开场白长度 | `AI.opening.maxChars`（28） |
| 朗读语速 / 分句 / 音色 | `AI.tts`（`enabled` false / `rate` 0.92 / `maxChunkChars` 28 / `lang` zh-CN）；设置面板可选系统音色 |
| 模型 / 超时 / 熔断 | `AI.runtime` + `AI.sampling`（Key 在设置面板；本机开发可用 `.env` 兜底） |
| 跨图检索门槛 | `MEMORY.retrieval`（`topK` / `minScore` 0.32 / `perSliceLimit`） |

## 资产

- `public/mediapipe/` 由 `scripts/prepare-assets.mjs` 生成（wasm 4 文件 + `hand_landmarker.task` 7.6MB），已进 `.gitignore`
- 缺失时运行期回落 CDN（`VISION.assets.cdn*`），鼠标键盘模式完全不受影响
- 刻意**不开启** COOP/COEP 跨域隔离：会让 CDN wasm 加载失败，单线程 wasm 足够 30fps

## 开发环境注意

- 建议 Node 22 LTS；用 `corepack pnpm` 可以避免 pnpm 不在 PATH 的问题
- 无头截屏（Edge/SwiftShader）会产出破损合成图，**不能**用于视觉验收；用 `?capture=1` 导出真实帧缓冲，或在真实浏览器里看

## License

MIT License © 2026 Memory River contributors

完整协议见 [`LICENSE`](./LICENSE)。
