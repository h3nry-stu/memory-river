# 已确认决策（2026-10-18）

这 6 条是用户明确拍板的设定，后续所有阶段以此为准。改动需先改这里，再改 `src/config.ts`。

## 1. 复位落点 = 「当前层级的起始点」

- **不再**复位到 L0 全景；在 L1 拨动过之后复位 → 回到 L1 起点；已在 L0 就停在 L0。
- L2 → 退回它所属阶段的根（L1）；L3 内复位不退出对话。
- 落地：`LAYERS.resetTargetByLayer = { L0:'L0', L1:'L1', L2:'L1', L3:'L3' }`
- 影响：阶段 2 状态机处理 `reset` 信号时读这张表，而不是写死 `'L0'`。

## 2. 照片导入 = 拖拽 + 文件选择器

- 不接系统相册、不接网络 URL。越简单越稳。
- 落地：阶段 3 在 `ui/MemoryCard.tsx` 之前加 `ui/DropZone.tsx`，只处理 `DataTransfer` + `<input type="file" accept="image/*">`。

## 3. AI runtime = DeepSeek（OpenAI 兼容），key 从 `.env` 读，必须留 mock

- Base：`https://api.deepseek.com/v1`，模型 `deepseek-chat`。
- key 读 `VITE_DEEPSEEK_API_KEY`（⚠️ VITE_ 前缀会打进前端产物，本机原型可接受，上线必须换自建代理 → `AI.runtime.proxyPathHint`）。
- **无 key / 断网 / 超时必须自动落本地模板**，不白屏不报错；连续失败达阈值后本会话不再尝试远端。
- 落地：`AI.runtime`（`timeoutMs` / `maxRetries` / `failureThreshold` / `mockFallback`），阶段 4 实现 `ai/runtime.ts` 双通道。

## 4. 音乐 = 程序化音景（Web Audio 合成）· 已废弃

> 2026-10-19 用户确认：不要程序化低频宇宙音。已移除 `MUSIC.synth` 与 drone / 拨弦 / 混响路径。
> 现在音乐只来自照片绑定的音频；未绑定或解码失败时完全静音。

## 5. 性能基线 = Mac M 系列 + 现代手机；老 Intel 降 LOD

- 只保证 M 系列与现代手机上「满画质」；老 Intel 掉到 low 档（关 bloom、砍粒子、关拖尾）可接受。
- 降档必须**补偿亮度**，否则光河的「光」会消失：`tiers.low.brightnessBoost = 1.85`、`exposureBoost = 1.45`。
- 降档不重建 buffer，只改 `drawRange` 与像素比（瞬间生效，不卡顿）。
- 落地：`PERF.lod`（tiers / memoryFloorGb / coresFloor / mobileUa / settleMs）。

## 7. 形态 = 横向蜿蜒的悬浮光丝带（2026-10-18 追加）

第一版做成了「地面上的河 + 消失点透视」，用户否掉。改为：

- **X 轴 = 时间主轴**：丝带从左到右横贯画面，起点在左、终点在右
- **Y 轴 = 正弦起伏**：主起伏 + 二次谐波，做出 S 形/波浪形，横贯画面正中间
- **Z 轴 = 纵深蜿蜒**：让丝带在宇宙里「飘」，而不是贴在一张纸上
- **彻底去掉地面透视**：没有地平线、没有流向远处，相机正视丝带（长焦压缩）
- **断面是星尘**：中心密集、边缘稀疏飘散，是发光丝带而不是水面
- **构图**：相机距离按视口比例自动解算（`RIVER.camera.widthFill`），任何屏幕比例下丝带都横向撑满、垂直居中

落地：`RIVER.spanWidth / wave / depth / ribbon / endFade / edgeFade / camera`、`particles/riverPath.ts`（slot↔x 唯一换算）、`river.vert.glsl`。
涟漪也从「水面上的环」改为「正对镜头在 XY 平面扩散的波前」。

**追加修正（同日）**：① 断面偏移改为**有界**（高斯 → tanh → ×上限），杜绝高斯尾巴把粒子甩到 ±20 外；
② 相机位姿与画布尺寸加运行期自检（`?diag=1` 导出包围盒/相机/画布）；③ 场景模块在 DEV 下强制整页刷新，
避免 HMR 留下「新几何 + 旧相机」的错位画面。

## 9. 长河的 3D 形态 + 照片只在 L2 出现（2026-10-18 追加）

- **L0/L1 不显示任何照片**：整条长河就是情绪粒子本身。照片（以及由粒子重组出的影像）只在 **L2** 出现，
  这是"放大到一件事"的语义：在远处只看见温度，靠近了才看见画面。
- **3D 中空螺旋星管**：保持横向 S 形主轴，但粒子用 **Frenet 框架**（法线 N ≈ 深度方向、副法线 B ≈ 画面上下）
  分布在圆柱面上，并按 `tube.twistTurnsPerUnit` 螺旋缠绕（`strands` 股），管心中空（`hollowRatio`）。
- **纵深表现**：用粒子相对轴线的 Z 分量做「正面提亮 / 背面压暗 / 背面偏冷 / 近大远小」，
  因为 30 单位焦距下真实透视只有 ~7% 的差距，必须人为放大才读得出立体感。
- 落地：`RIVER.tube` / `RIVER.depthCue` / `RIVER.innerGlow`、`riverPath.ts` 的 `frameAtX` / `pointOnTube`、
  shader 属性 `aPhase`（角向相位）与 `aRadius`（归一化半径）。

## 6. L3 = 纯文字，TTS 先不做但留接口

- 落地：`AI.tts = { enabled: false, maxChunkChars, speakRateWpm }`。
- 阶段 4 的对话 UI 按「逐句吐出」的节奏做，将来接 TTS 时只需把每句交给语音层，不改结构。

## 10. 「切照片卡一下」的根因与修法（2026-10-19 追加）

真机反馈："照片切换的时候很卡很僵硬，一点也不流畅"。拆成三件事分别量化、分别修：

**① 每帧同步重建节点（主因）**
`PhotoField.sync()` 以前每帧都按"视口 ±3 张"重建窗口：滚出界立刻 `dispose`，滚回来立刻重建，
而重建要 `canvas.getImageData`（GPU→CPU 回读，会 stall）+ 3.6 万次采样 + 上传 GPU 缓冲。
扇一下滚 2–3 张 → 每帧都在建/删 → 掉帧。

- **点云与像素字节两级 LRU 缓存**：`getImageData` 结果按 `photo.id` 缓存，采样结果按 `id@x` 缓存。
  ⚠️ 缓存键必须带 `x`（长河重排后散落坐标会变），但**像素字节**不带，重排也能复用。
- **粒子数只跟"相册总张数"有关，并量化到 1000 的整数倍**：以前按"窗口里有几张"摊预算，
  窗口一变 `count` 就变 → 缓存全部失效（实测同一张照片被重采样 14 次）。现在 12 张 → 每张固定 15000。
- **两级半径 + 迟滞**：建用 `prefetchRadius`（5 张），删用 `prefetchRadius + 1`（6 张），边界抖动不再来回建删。
- **每帧最多建 1 个节点**（`buildPerFrame`），剩下的排队下一帧；`pending > 0` 时跳过滚动节流继续建。
- **共享纹理不能在节点 dispose 时释放**：以前节点一删就 `texture.dispose()`，滚回来要重新上传整张图。
  现在只在 LRU 淘汰时释放。

**② 相机横轴被"最近那张"锁死（"僵硬"的来源）**
`composePose()` 里横向与纵向共用一个 `focusWeight`（`progress 0.35→1`）。L1 时它就等于 1，
于是相机 x **直接等于焦点照片的 x**：扇动过程中焦点每变一次，相机就整段跳一格 —— 看起来就是一顿一顿。
现在横向单独用 `progress 1.55→1.95`：L0/L1 完全跟着 `scrollX` **连续**滑，只有快进 L2 才对准焦点。
（纵向仍用 0.35→1，抬到照片高度这件事在中景就该完成。）

**③ 焦点之外的照片在纯烧填充率**
L2 相机贴得很近，邻居张早已在屏幕外，却仍在画 3.6 万颗泼溅。现在按"隔几张"淡出到不画
（`PHOTO.focusFade`：L1 2.4→3.6 张，L2 1.3→2.1 张）。

**验证方式**（不靠肉眼）：`?sweep=1&demoPhotos=12&lod=high` → 读 `#mr-sweep`。
合格线：`maxBuildsPerFrame ≤ 1`、`sampled = 15000 × 张数`（每张只采样一次）。
另外 `debugScrollTo` 现在会同步步进 60 帧让相机 y/z/距离收敛 —— 否则无头环境里量到的
"照片不在正中"是探针自己的假象（实测修正后 `scrollTo = 0/21/42/70` 全部 `x=0.500, y=0.500, r=0.518`）。


## 11. 照片"高清一点点"的调整（2026-10-19 追加）

需求："把那个图片高清一点点"。先量化，再调，避免越调越糊或越调越卡。

**先量**：给 `?exposureProbe=1` 加了**清晰度指标** —— 把「渲染帧的照片区域」与「源图同区域」
都缩放到同一个 320×200 画布，算相邻像素亮度差的平均值（`rendered / source`，
1.0 = 和源图一样锐，0.17 = 糊掉 83%）。同时修了对比不公平的老 bug：两张图原来缩到不同像素尺寸，梯度没法直接比。
另外加了 `?demoDetail=1` 生成一张**高频测试靶**（棋盘 + 1px 细线 + 三档小字），糊了立刻看得出来。

**量到的起点**：`ratio = 0.17`。原因是画面完全由高斯泼溅堆出来，而斑块直径约 14px（`worldSize 0.062`）。

**四个旋钮（按性价比排序）**

| 改动 | 为什么 | 实测 |
| --- | --- | --- |
| `l2.planeOpacity` 0.14 → **0.42** | 颗粒云再密也是柔光斑；真正的像素级锐度只能来自那层全分辨率贴图 | 0.17 → 0.37 |
| `splat.core` 新增，2.2 → **4.0** | 渲染画面 ≈ 源图卷积这枚核，核越紧越锐；粒子间距（~2.3px）远小于斑块半径，收核不会有空洞 | 0.37 → 0.43 |
| `sizeJitter` 0.85 → **0.45** | 尺寸差 2 倍的大斑块正是"蒙一层灰"的来源；E[d²] 几乎不变，覆盖率不掉 | +0.02 |
| 粒子数 × 清晰度 | 覆盖率 ∝ N×d²，所以"变清"必须"粒子数 ÷ d²"一起给 | 见下 |

**最终**：`particlesPerPhoto 8 万`、`worldSize 0.042`、`core 4`、`intensity 0.58`、`planeOpacity 0.42`
→ **ratio 0.45**（清晰度 2.6 倍），曝光均值仍在 ±1 内（源 (136,134,131) → 渲染 (148,135,101)）。

**顺带修掉的两个必然踩到的坑**

1. **相册一大就变脏**：粒子预算按张数平摊，12 张时每张只有 2.5 万 → 同样大小的斑块盖不满，
   照片变成"露底"的脏斑（实测 12 张时 g −11 / b −34，肉眼可见渗光）。
   解法：斑块尺寸跟着密度走 —— `worldSize × √(N_ref / N)`，覆盖率恒定。
   现在 3 张与 12 张的渲染结果**完全一致**（mean 与 ratio 都一样），只是大相册会略软一点。
2. **建节点的成本涨了 5 倍**（8 万粒子 ≈ 6ms/张）。两条对策：
   - 采样路径优化：sRGB→线性改成 256 项查表（省 24 万次 `Math.pow`）；
     散落坐标不再每颗粒子算一次 Frenet 框架（一条波长内框架几乎不变），省掉 8 万次三角 + 24 万个临时对象。
   - **空闲预热**：导入后用 `requestIdleCallback` 一张一张先采好点云，
     扇动时永远是缓存命中。`?sweep=1` 复验：`maxBuildsPerFrame` 仍为 1，`sampled = 8万 × 张数`（每张只采一次）。

**验证方式**：
`?capture=1&exposureProbe=1&demoPhotos=12&demoDetail=1&focus=0&layer=L2` → 读 `#mr-exposure` 的
`sharpness.ratio`（应 ≥ 0.4）与 `meanDelta`（应 < ±2，蓝色在强白区域会被 ACES 压暖，属已知特性）。

## 12. 阶段 4：切片人格、跨图记忆与对话 UI（2026-10-19）

需求原文四条：玻璃拟态对话 UI、两层人格 prompt、**跨图记忆串联**、Mock + 真实 API 预留（TTS 加分）。
下面是落地时的关键取舍。

**① 面板怎么"不遮挡主体照片"**
移动世界很贵、还会牵动焦点/命中检测。改成偏投影：面板打开时给相机加
`camera.setViewOffset(W, H, +W_panel/2, 0, W, H)` —— 只平移视锥中心，不改 fov/aspect，
所以 `projScale`（高斯泼溅的像素尺寸）完全不受影响，照片只是"往左挪了 210px"。
窄屏（aspect < 1.35）改成底部抽屉，偏移换成向上让位。
实测（1280×800）：照片中心 x 从 0.500 → 0.335（左移 210px），面板左边界 852px，
照片右边界约 657px —— 完全不重叠。窄屏（492×769）照片中心 y 0.5 → 0.27，抽屉从 543px 开始，同样不重叠。

**② 切片人格是"确定性生成"的**
用户只给了一张图，没有年份/地点。于是用 **photoId 哈希**（xmur3 + mulberry32）从
`AI.slices` 的词库里确定性抽：年份 / 季节 / 地点（含说话风格、器物、声音）/ "那天的你在做什么"。
确定性很重要 —— 同一张图永远是同一天，刷新、长河重排、来回切换都不会变，
否则"这个分身"的人格会漂移，跨图记忆也就说不通了。
照片自己的平均色再决定语气：暖 → 说话松一点，冷 → "声音是闷的"。

**③ 跨图记忆 = 检索，不是预载**
每次说话前，`retrieval.ts` 把**别的切片**的对话与事实摊平成语料，用
「中文二元组重合 × 0.55 + 情绪标签重合 × 0.3 + 用户发言加成 × 0.15」打分，取 topK。
不引入 embedding：这种短句、口语化、情绪高度重复的对话，词法匹配召回够用，
而且完全离线、可解释、可复现（还能在 `?chatSim=1` 里逐条看到分数与命中）。
情绪词表里**单字词（好/想/累/怕/空/沉/闷）只做标签，不参与意图判定** —— 否则「你好」会被当成在倾诉情绪。

**④ 引用要"说人话"**
第一版把用户原话前 8 个字直接拼进去，出来是「你刚在「X」说那天我很难过一直」（截断在半句）。
改成**引用情绪词本身**：「你刚在「X」说难过，这张其实也是。」 —— 人回忆时记住的就是那个词。
同一张图只保留一条引用（去重），否则气泡下面会挂两个一模一样的标签。

**⑤ Mock 必须是"能聊下去"的**
它不是占位文案：意图（问候/身份/时间/地点/情绪/重复/打听"你记得我吗"/兜底）× 切片事实槽位 ×
人格约束（字数上限、陈述:提问 3:1、不连续追问、口头禅每 4 条一次、说过的器物不重复）拼出来。
`?chatSim=1` 的实测输出：

```
我: 那天我其实很难过，一直没说话      → 那天也是这种沉。那天有被风吹得糊在脸上的头发。
我: 今天也很累，有点难过（换了一张）  → 你刚在「2017 早春 · 海边」说难过，这张其实也是。那天有消毒水的味道。
我: 这是哪儿来着？                    → 医院的走廊。手边还有消毒水的味道。
我: 你好                              → 嗯。海边，风里还有冬天的尾巴。
```

**⑥ 对话框存在也不会被手势抢走**
面板一出现就有 textarea：空格会拨动长河、回车会跳层、G 会切输入模式。
三处都加了 `isTextEntry(event.target)` 让路（Stage 的层级键、Hud 的 G 键、Stage 的 Enter 聚焦）。
另外面板打开期间：手势缩放被钉在 L2（`onZoom(2)` + `stageBridge.zoom` 直接 return）、
扇风也不生效 —— 聊天时手放着不该把画面拉走；换记忆请用面板上的 `‹ ›`。

**⑦ 远端只做"更好"，不做"必需"**
`runtime.ts`：无 key → 直接 mock；有 key → fetch + AbortController 超时 + 重试 1 次，
连续失败 3 次熔断 5 分钟，本会话不再尝试（现场断网不能每次都等 20 秒）。
任何路径都不抛错给 UI —— 最坏情况是"回复变成了规则生成"，而不是白屏。
所有输出都过 `guard.ts`：删客服腔/抒情总结、压到 60 字、去重复口头禅。

**⑧ TTS**
Web Speech API，零成本零网络。分句入队（每句 ≤ 28 字）、语速 0.92、优先 zh-CN 语音，
开关持久化到 localStorage。浏览器要求先有用户手势才能出声 —— 回复前用户刚发过消息，满足条件。

## 13. 阶段 4 UI 改版：从玻璃面板 → 沉浸式悬浮台词（2026-10-19）

真机反馈带来了参考效果图，要求"极致沉浸、没有明显边框"。原来那套右侧玻璃面板
（宽度 392、相机会横移让位）被整个废弃，改为：

**① 台词浮在照片周围，没有面板**
AI 的话靠左、你的话靠右，同时最多 5 条，`fadeByAge` 让越旧的越淡（1 → 0.16），
每条按消息 id 做一次**确定性哈希**决定的水平/纵向微抖动 —— 所以它们像飘着，而不是一列列表。
文字压两行暗影 + 极淡玻璃底（`bg-black/25` + `backdrop-blur-[3px]`），压在亮粒子上也读得清。
引用别的照片时只在下面留一行 8.5px 的 `↗ 想起 2017 初冬 · 武汉`。

**② 底部只剩一枚胶囊**
按住说话（`data-chat-talk`）走 Web Speech Recognition，松开即发送；**空格**是同一个动作
（对话打开且没在输入框打字时由对话层接管，Stage 的 Space/Esc 会主动让路）。
旁边是「◈ 凝聚记忆」和一行几乎隐形的输入框（回车发送，聚焦时才变宽到 15rem）。

**③ 相机让位从"横移"改成"上移"**
没有面板了，横向不再需要偏移（照片保持居中 `x = 0.500`）；改为整体上移
`AI.ui.photoLiftVh = 7%` 视口高度，给底部台词和胶囊让出干净落点。
实测 `?diag=1`：`inset.y = 46.8`，`focusProjection.x = 0.500`。

**④ L2 背景压到纯黑 + 边缘星尘化**
- `cosmos` 新增 `uDim`：`deep = smoothstep(p,0.6,2)²` 时把星云/地平线光乘到 0；
  河体 opacity 降到 1.5%、亮度降到 15%、星尘几乎不画。照片于是"悬浮在黑里"。
- 边缘之前偏硬，是因为粒子在最外圈的不透明度一直是 1。现在：
  - `uEdgeAlpha 0.32` + `uEdgeFadeStart 0.78`：只有最外 22% 的粒子被压暗（中心保持锐利）
  - `uEdgeDrift 0.26`：最外圈沿径向往外飘一点、Z 上散开 → 边界化进四周的尘埃
  - `planeFeatherStart 0.62`：贴图羽化带从最外 22% 加宽到 38%
  实测截图：背景接近纯黑，照片核心依旧锐（棋盘与"记忆 1"清晰可读），边缘是一片星尘。

**⑤ 预埋用户设定 + 地点串联**
`AI.userProfile`（在住杭州 / 去过武汉·厦门·成都·西安 / 四条性格）。
它属于「溯」对**你**的认识，不是别的切片发生过的事，所以可以进系统提示，
不违反"切片不预载全局事件"。
城市按**导入序号轮转**（`(index-1) % 5`）：第 1 张永远是在住的杭州，第 2 张起是武汉、厦门…
这样"杭州的照片"和"武汉的照片"必然同时存在，地点串联才演示得出来。
`retrieval` 增加 `placeTagsOf` 与 `placeHit 0.28` 权重；mock 增加 `place` / `askHome` 两个意图：

```
武汉的照片：武汉你记得吗      → 武汉。那天就在这儿。
杭州的照片：武汉呢            → 武汉是去的，你不住那儿。这天在你住的杭州。  （+ 引用武汉那张）
任何一张：  我住在哪来着      → 你现在住杭州。你不太喜欢人多的地方。
```

**⑥ 「凝聚记忆」不是装饰**
点一下把这段对话压成一句摘要（`MemoryDigest` → `store.digestsByPhoto`），
摘要会进入**跨图检索**的语料并且权重高于零散对话 —— 所以"凝聚"过的记忆，
别的切片之后更容易想起它。实测摘要：
`2014 梅雨季 · 绿皮车（杭州）那天，你说过难过、累，说过「今天也很累，有点难过」。`

**⑦ 回归**
`?sweep=1` 仍然 `maxBuildsPerFrame = 1`；`?simMachine=1` 五个手势判定不变；
L0 仍然「无黄圈、零照片、无对话」；窄屏（492×769）底部条 `overflowX = 0`。

## 14. 阶段 4 强化：陪伴感三件套（2026-10-19）

参考「念念」那类陪伴型产品，补三个"被记住"的机制。**极简 UI 不动**：没有新面板、没有新按钮，
只在原有台词与胶囊上加了极小的一层。

**① 私密碎碎念的口吻**
Mock 的回复结构从"事实报告"改成固定两段：**先接住情绪（hold）→ 再把照片里的东西拉到此刻（bring）**。
情绪表在 `AI.mock.diary.hold`（sad/tired/happy/lonely/afraid/miss/neutral 各有 2–3 句），
`bring` 用 `{sound} / {prop} / {air}` 这几个槽位，所以每张照片拉过来的东西都不一样。

```
今天好累 → 嗯…照片里的光落下来，跟你现在屋里有点像。
       → 嗯，那就歇一会儿。推车轮子碾过地砖。那天一直没停。
```
配合 `guard.ts` 新增的 `ADVICE_PATTERNS`：「建议 / 应该 / 可以试试 / 你需要 / 注意身体 / 随时找我」
这类整句删除 —— 树洞不说话，只记得。`?noteSim=1` 的 `isAdvice` 字段就是这条的验收位。

意图顺序也调整了：问候与道谢**先于**情绪判定，单字情绪词（累/怕/想）作为最后一级兜底。
否则「你好」会被"好"判成开心、「今天好累」却完全接不住。

**② 记忆手记（退出时后台写，下次进来引用）**
- 触发：离开这张图（返回 L1 / 换一张）→ `App` 的订阅里调 `scheduleNote(photoId)`
- 写入：延迟 `AI.note.delayMs = 900ms`（让"离开"这个动作先完成），少于 2 轮不写；
  规则拼句，不依赖模型：`在{城市}的{地点}，你说「{最长的那句发言}」；{器物}还在。`
- 落地：`store.notesByPhoto`（自动 + 手动「凝聚记忆」共用一个容器，`kind` 区分）
- 引用：再次进入时 `ensureThreadOpened` 先调 `flushNote`（用户回来太快就先结算），
  然后补一句「上次我写：……」，并打上 `quotedAtMs` —— **只念一次**。
- 复用：手记同时进跨图检索语料（权重高于零散对话），所以别的切片也会想起它。
实测（`?noteSim=1`）：手记生成 → 再进来被引用 → `quotedOnce: true` / `notRepeated: true`。

**③ 记忆引用视觉化（记忆碎片）**
引用另一张图时，那行小字前面浮出一枚 6px 的**菱形碎片** + 3 颗向上飘散并淡出的粒子
（纯 CSS：`shard-pulse` 3.4s 呼吸 / `shard-rise` 3s 错峰上浮），
`title` 里带完整原话。它只在"真的引用了"时出现，所以不会常态闪烁干扰阅读。
实测 DOM：`shardCores: 1` / `shardDots: 3`。

回归：`?sweep=1` 仍 `maxBuildsPerFrame = 1`；L0 仍「无黄圈、零照片、无对话」；
`?chatSim=1` 七轮跨图/地点串联全部通过；`?chatPanel=1&chatUi=1` 输入→发送→碎片→凝聚全绿。

## 15. 底部控件重排：三层结构 + 让出 HUD（2026-10-19）

反馈：「按钮都挤在一起了，而且按钮不太明显」。两个根因，都修了：

**① 一行塞了 6 个控件**
原来输入框、按住说话、凝聚记忆、声、›、返回 全在同一行（`gap-2`、`h-6~9` 混排），
既挤压又没有主次。改成**三层右对齐**，每层只做一件事：

```
写一句 [输入框]                      ← 输入行（几乎隐形，聚焦变宽变亮）
            [声] [›] [返回]         ← 图标行（h-7 圆形/胶囊，border-white/20）
   [◈ 凝聚记忆]  [● 按住说话 空格]   ← 主胶囊行（h-10，gap-3；说话按钮最亮最大）
```
主次分明：按住说话 `border-2 border-white/35 bg-white/[0.13] text-stardust/95` + 发光圆点，
凝聚记忆 `border-white/20 bg-white/[0.07] text-stardust/80`，图标行 `text-stardust/70`。

**② 底部和 HUD 打架**
HUD 的页脚（右下遥测 + 左下缩略图）本来也在底部，和对话控件叠在一起正是"挤成一团"的观感。
现在 `dialogOpen && layer === 'L2'` 时页脚整体淡出（`opacity-0 + pointer-events-none`，500ms），
底部完全交给对话层，顶部标题/层级导轨/导入保留。

**③ 台词栈自动躲开底栏**
栏高会随提示行动态变化，所以用「视口高 − 栏顶边 + 12px」量出占位（`ResizeObserver` +
提示行/语音状态变化时显式再量一次），台词栈的 `padding-bottom` 跟着它走。
实测（1280×800）最后一条台词底边 463px < 栏顶边 470px；窄屏（492×769）549 < 570 —— 都不重叠。
回归：`?hitTest` 三个控件 `clickable: true`；`?noteSim` 手记/引用/只念一次全绿；`?sweep` 仍 1；L0 仍纯净。

## 16. 语言系统回归克制 + 视觉接地（2026-10-19，本阶段最终形态）

参考「念念」那一版把口吻带偏了（抒情、情绪化、写手记），用户要求**立刻回退并锁死**。
这一条是阶段 4 的最终约定，后面改文案先读这里。

**① 碎碎念 / 手记生成：已废弃**
- 删掉 `AI.mock.diary`（hold/bring/musing 那套把情绪"借"过来的写法）
- 删掉整条手记链路：`src/ai/notes.ts`、`notesByPhoto`、退出时 `scheduleNote`、"上次我写：…" 引用
- `◈ 凝聚记忆` 保留，但产出改成**事实摘要**（`digestsByPhoto`）：只写"哪天、谁说了什么"，不写情绪

**② 话术铁律（可执行版）**
结构固定为 `[接住 ≤5字] + [一句具体的] + [偶尔一个短问]`：
- 陈述 : 提问 = 3:1（`statementToQuestionRatio`），且**绝不连续追问**（看上一句有没有问号）
- **单句 ≤ 15 字**：`clampSentences()` 在标点处断开，断不开就硬裁 —— 这条在 guard 里硬执行，
  远端模型吐长句同样被裁
- 具体 > 抽象：`ABSTRACT_EMOTION` 正则把「你一定…」「我心疼你」「加油」「抱抱」「希望你能…」整句删掉
- 允许不确定：「我记不清了。」写进 `AI.mock.voice.unsure`，什么都不确定时就用它结尾

实测（`?toneCheck=1`）：`allShortSentences / allShortTotal / allNoAdvice / allConcrete / guardStable` 全 true，
`statementToQuestion = 14:0`。

**③ 识图不准的根治：视觉标签 + 地点候选池**
原来切片的年份/地点是 **photoId 哈希随机**出来的，跟画面无关 —— 于是对着海边说"便利店的关东煮"。
现在 `src/photo/vision.ts` 在**导入时**做一次像素统计（64×64）：
亮度/对比度/色温/饱和度、九宫格明暗、绿/蓝/肤色占比、高光/暗部比例、边缘密度。
- **地点候选池由统计决定**（暗→便利店/窗台/桥上；绿多→院子/小路/山中；蓝多+上方亮→海边/桥上；
  细节少→走廊/画室；有人→街市/车站），哈希只在池内挑 → 地点和画面对得上
- 统计直接产出**能说出口的画面事实**（"大半是暗的。""蓝色占了大半。""有人站在光里。"），
  写进切片事实 + prompt（远端模型也拿得到）
- 「你笑得很用力」这类**对人的推断**只在 `visual.skin > 0.05`（画面里真有人）时才允许，否则一律说"看不出"

**④ L2 核心更实、边缘仍散**
`planeOpacity 0.42 → 0.58`（全分辨率贴图承担主体清晰度）、`planeFeatherStart 0.62 → 0.70`
（只让最外 30% 羽化）、`edgeFadeStart 0.78 → 0.84`（只有最外 16% 的粒子被压暗）、
`intensity 0.58 → 0.70`（核心泼溅更浓）。`edgeAlpha 0.3 / edgeDrift 0.26` 保持不变 ——
所以主体清楚、边界依旧化进星尘。截图确认：棋盘与文字清晰可读，四周是飘散的尘埃。

**⑤ 回归**
`?sweep=1` 仍 `maxBuildsPerFrame = 1`；`?simMachine=1` 五个手势判定不变；
L0 仍「无黄圈、零照片、无对话」；`?chatPanel` 的输入→发送→记忆碎片→凝聚全绿（`speechClearsBar: true`）。

## 17. 真机回炉：六个冲突的修复（2026-10-19，阶段 4 定稿）

真机体验暴露了严重冲突，逐条修：

**① 聊天时握拳退不出去（最严重）**
两个地方同时锁死了缩放：
- `stageBridge.zoom` 里我加的 `if (dialogOpen) return;`
- Stage 渲染循环里「握拳就 `rig.holdProgress(2, 220)` 续锁 L2」
- 加上 `LayerRig.setProgressTarget` 的确认锁（`holdUntil`）把**缩小**也一起挡住了

修法：删除前两处；`setProgressTarget` 的锁**只作用于"想更近"**（`leaving = next < progress` 时永远放行）；
滚动中如果要"离开"，先把滚动停住再放行。
验收：`?gestureChat=1` → 聊天中握拳 `target=0`（立刻）、张手 `target=2`、扇风换图 `true`。

**② UI 挡视线、按钮失灵**
- 台词改成**纯悬浮字**（电影字幕）：去掉 `bg-black/25` 气泡与所有边框，只靠两行 `text-shadow` 抠出可读性
- 底部只留三样：几乎隐形的输入框、按住说话、一个 `×`。**删掉**了 凝聚记忆 / 声 / › / 文字返回
  （换记忆靠扇风，退出靠 ×/Esc/握拳）
- 防"点了没反应"：`touchAction: none` + `pointer-events-auto` + `z-40/50` + `onPointerDown` 里
  `preventDefault + stopPropagation` + `onClick` 兜底 + **短按没识别到语音时自动聚焦输入框并提示**
- 验收：`?chatPanel` 的 `hitTargets` 三个全 `clickable: true`（用 `elementFromPoint` 实测）

**③ 严禁编造景物**
- `vision.ts` 新增**视觉锚点**：只在证据够硬时报"人/树/天空/水/夜景/暖光/墙/室内/街景"，
  每个锚点带一句能直接念的话（"有树。""像在夜里拍的。"）
- **锚点为空 → 不许说画面**：开场白直接是「看不出这是哪儿。」；问「记得那扇门吗」→「看不清门。」
- 切片的"地点"也不再是哈希随机，而是**只由锚点推出**（认不出就没有地点）
- prompt 里写死：「没列在上面的景物一律不许说。认不出就回『我记不清了』。」

**④ 人格加入网感**
`AI.mock.memes`：轻松语境按 0.62 概率抛梗（`这瓜保熟吗。` `尊嘟假嘟。` `你不对劲。`），
**情绪低落时禁用**（`avoidEmotions`），且有 2 条冷却。
优先用**真锚点**抛梗：「这人看着像奶龙。」——只有真认出来的东西才敢比。
同时清掉"我记得的/我记忆里"这类废话（`noFiller` 验收位）。

**⑤ 跨图不背板**
引用句改成随口一提（「另一张你也这样。」「上次也是这个。」），具体是哪张图交给记忆碎片标签，
绝不说"你刚才说过……"。

**⑥ L2 核心更实**
`planeOpacity 0.58` / `planeFeatherStart 0.70` / `edgeFadeStart 0.84` / `intensity 0.70`，
边缘仍由 `edgeAlpha 0.3 + edgeDrift 0.26` 化进星尘。

回归：`?sweep` 仍每帧只建 1 个节点；`?simMachine` 五个手势判定不变；L0 仍纯净；构建通过。

## 18. 去模板化话术 + L1↔L2 抖动根治（2026-10-19）

**① 话术"人机感"的来源是"固定索引轮询"**
原来用 `turns.length % pool.length` 选句子 → 开场白以可预测的顺序循环，
加上固定的"接住+具体(+追问)"三段式，读起来就是填表。改成：

- **形状随机**：每轮从 `minimal / echoVisual / visualOnly / crossVisual / meme / greetVisual` 里挑一种，
  所以有时只说一句「像在室内。」，有时是「难过啊。有人。」
- **回声**：把用户自己的情绪词还回去（「难过啊。」），比任何模板都自然
- **反重复**：`pickFresh()` 会排除最近说过的句子；画面细节也按"说过的就跳过"推进
- **热梗的语境判断修正**：原来用 `sharedEmotions` 判断"是否轻松"，第一轮没有跨图数据时恒为轻松
  → 「我很难过」也可能吃到一个梗。现在只看**用户这句话本身**的情绪标签，
  判到 sad/tired/lonely/afraid 就绝不抛梗。

连跑三次同一组输入，输出节奏都不一样（README 里贴了三组）。

**② L1↔L2 扩大缩小的抖动：目标是"两套系统在拉锯"**
- `Stage` 的渲染循环把连续进度派生成离散层写回 `store.layer`；
- 而 `store.layer` 的订阅一看到 `'L2'` 就 `rig.holdProgress(2, 1300)`，把目标钉死在 2；
- 连续缩放的用户手微微收回 → 派生层变回 `'L1'` → `rig.setLayer('L1')` → 目标被拉回 1。
于是进度 1.5 边界上目标在每个往返里被拉扯一次，表现为"张开推到 L2 时顿一下 / 泵一下"。

修法：加 `derivedLayerSync` 标记 —— 派生层变化只用于 HUD 显示，**不再驱动 rig、不再上锁**。
另外两处也在同一段路上：
- 阻尼在 `|目标-当前| > 0.35` 处硬切换（刚度突变约 4 倍，且 0.35 正好落在 L1→L2 中间）→ 改成平滑过渡；
- 横向回中门槛 1.3 → 1.75、让位上移门槛 1.35 → 1.9（否则张开推 L2 时照片会横向漂 / 竖跳）。
- `stageBridge.zoom` 也不再因为"滚动中"吞输入（防误触交给状态机的 `zoomFreezeMs`）。

验收：`?zoomSweep=1` 的 `L1→L2 / L2→L1 / L0→L2` 三趟 `maxStep ≤ 0.047`、`reversals: 0`、`driftX: 0`；
`derivedLayerKeepsTarget.target = 1.6`（派生层不再拉走目标）。

## 19. 扇风滑动被缩放路径"顺手杀掉"（2026-10-19）

真机："滑动怎么又出问题了"。根因是我在上一条里为了"手势缩放绝对生效"，
把 `stageBridge.zoom` 的拦截去掉时，顺手加了一句：

```ts
if (Math.abs(scrollVel) > SCROLL.stopVelocity * 2) { scrollVel = 0; snapTarget = null; }
```

而 `stageBridge.zoom` 是**手势引擎每帧调用一次**的（无论用户是否在缩放）。
于是每一记扇风产生的惯性，都在下一帧被这句话清零 —— 滑动等于完全失效。

**铁律**：每帧调用的入口（`stageBridge.zoom` / `swipe`）**不允许有任何副作用**。
缩放路径现在只做一件事：`rig.setProgressTarget(target)`。
"扇风时别顺手缩放"由状态机的 `zoomFreezeMs` 负责，滚动与缩放互不干涉。

**回归探针 `?flickCheck=1`**：按真实链路顺序逐帧模拟 —— 先 `stageBridge.zoom(2)`（手静止张开的常态），
再 `updateScroll(1/60)`，然后跑完惯性 + 吸附。实测：

```
轻扇 -1.2 → 滚 1 张    正常 -2.5 → 滚 3 张    猛扇 -4 → 封顶 3 张    allPass: true
```

同时确认前一条的修复没有被破坏：`?zoomSweep` 三趟 `maxStep ≤ 0.047 / reversals 0 / driftX 0`、
`?gestureChat` 聊天中握拳 0 / 张手 2 / 扇风 true、`?toneCheck` 全绿、`?sweep` 每帧仍只建 1 个节点。

## 20. 阶段 4 第三轮定稿：玻璃拟态 + 握拳退出 + 朋友人格（2026-10-19）

**① 握拳退出提为最高优先级（真机致命 bug 的最终修法）**
之前两轮都在"锁"上打补丁（去掉 dialogOpen 拦截、让"离开"绕过 hold），但仍然退不出去。
真正的根因在**分带映射**：
- `progressForBand('L2', unit) = 1 + unit` → **下限就是 1.0**，靠连续缩放永远回不到 L0；
- 要退回得先满足「unit ≤ backToL1At(0.12) 且保持 backToL1HoldMs」，实机上握拳的 openness 常在 0.2–0.3，**根本触发不了**；
- `progressForBand('L1')` 更是硬 `return 1` → L1 里静止合掌完全不响应。

修法两条：
1. **新增 `GESTURE.fistExit`**：手保持握拳 460ms（> quickWindowMs 420，所以"快速握一下"仍是进入），
   **任何层、任何状态**都把 `committed='L0'`、`zoomTarget=0`。这条规则不看"手是否静止"、不看分带、不看聊天状态。
   进入 L2 后加 1200ms 闩锁 + "必须先张开一次"，避免进来就弹出去。
2. `progressForBand('L1')` 改成向下连续 `min(1, unit × 1.35)`，向上仍锁死 1（没确认绝不越过 L1）。
验收 `?fistExit=1`：`{L2, 2} → {L0, 0}`，`pass: true`。

**② 苹果玻璃拟态**
底部三件套统一用两个共享 class：
- `GLASS_WRAP`：`p-[1px]` + **上亮下暗的渐变描边**（模拟玻璃边缘高光）+ 深投影
- `GLASS_INNER`：`bg-white/[0.10]` + `backdrop-blur-2xl` + `saturate-150` + 内侧顶部高光 + 内侧底部暗边
说话时额外浮出一条**玻璃语音条**显示实时转写。台词仍然只是悬浮字（不加框）。
点击一律落在内层元素上，`?chatPanel` 的 `hitTargets` 三个全 `clickable: true`（含 430px 窄屏）。

**③ 人格：从"捧哏"改成"朋友"**
- **删掉必选的"嗯。"前缀**：`AI.mock.voice.react` 按情绪给有态度的话（`那就瘫着。` `别硬撑。` `沉就沉吧。`）
- 形状池重写：`react / reactDetail / reactMeme / echoDetail / detailOnly / crossDetail / memeOnly`
- 热梗概率 0.62 → 0.75，且**只看用户这句话的情绪**决定能不能抛（sad/tired/lonely/afraid 一律不抛）
- **进 L2 不再自动说话**（`AI.opening.enabled = false`）——"第一句就别说话了"，安静的人才像老朋友

**④ 识图**：锚点机制不变，认不出就「看不清门。」/「记不清了。」，绝不顺着编。

## 21. 接真实模型 + 手势改回之前（2026-10-19，用户指令）

**① 接入真实模型（默认就走在线的）**
- key 从 DSH 凭据里取，写进 `.env` 的 `VITE_DEEPSEEK_API_KEY`（`.env` 已 gitignore）
- 默认链路：`sendChatMessage → runtime.completeChat → api.deepseek.com/v1/chat/completions`
- 验收 `?aiCheck=1`：`source: "remote"`、`hasKey: true`、`reply` 是模型原话
- 实测 `?chatSim=1`：跨图引用与地点记忆都能自然带出（见 README 引用段）

**② 规矩放宽（"不要那么多规矩了"）**
- `guard.ts`：**不再**硬裁单句、不再删建议腔/客服腔/抒情句、不再套模板化句式；
  只做标点整理、段落折行、120 字安全上限
- `persona.ts`：从十几条硬规则缩成 6 行"气质"，让模型自己发挥
- `AI.reply.hardMaxChars` 45 → 120；`sentenceMaxChars` 退化为 Mock 内部使用
- `stripBanned()` 保留导出但默认不调用（想恢复严格模式可直接用）

**③ 顺手修的两处提示词问题**
- 用户设定段落里明确写「这些讲的是**对方**，不是你自己」——
  之前模型会把"你习惯把话咽回去"当成自己的性格说出来
- 字幕要一条条浮，所以 guard 把段落换行折成空格

**④ 手势：握拳退出改为最高优先级（2026-10-19 交接重构）**
- `GESTURE.fistExit.enabled = true`、`holdMs = 360ms`：任何层级 / 聊天中都直接回 L0
- `progressForBand('L1')` 保持硬锁 `1`（L1 拨照片不切层）；握拳退出是独立规则，不走分带
- 派生层级写 store 时打同步标记，手势引擎不再把它当成"用户确认"去 commit 分带
- 保留：阻尼平滑、缩放路径无副作用（不杀扇风惯性）
- 回归：`?simMachine` 五项不变、`?flickCheck` `[1,3,3]`、`?zoomSweep` `maxStep 0.023 / reversals 0`

## 22. 去掉虚构元信息 + 可选 LLM（2026-10-19，用户指令）

**① 不再编造时间 / 城市 / 来源**
- 删除 `slices.ts` 里按 photoId 哈希生成年份、季节、城市，以及按导入序号轮转城市的逻辑
- 删除 prompt 里的虚构用户人物志（杭州 / 武汉 / 厦门 / 性格条目）
- 切片标签改用**用户实际导入的文件名**（跨图引用的标签能对上来源）
- 系统没有 EXIF / 用户输入时，prompt 明确写"没有拍摄时间、地点、来源地址"，模型不会补全

**② 不再给输出加限制**
- `guard.ts` 只做首尾空白清理：不裁句、不压字数、不删建议/抒情
- `persona.ts` 只保留身份与用户选中的气质，不再注入口头禅、3:1、字数、禁说清单
- 采样参数仍在 `AI.sampling`

**③ 用户可以自己选 LLM 并填 Key**
- `AI.providers`：DeepSeek / OpenAI / Moonshot / 通义千问 / 智谱 / SiliconFlow / Ollama / 自定义
- 设置面板：服务商下拉 + 模型 datalist（可选可手填）+ Base URL + 自己的 API Key
- 全部走 OpenAI 兼容 `/chat/completions`；Key 存 localStorage，留空时才回落 `.env`

## 23. 人格蒸馏 + 动态热梗库（2026-10-19，用户指令）

**① 人格蒸馏**
- 设置面板 06：4 个人格 Tab，多行 textarea + 多选上传截图 OCR + 「解析并生成人格」
- 多张截图串行识别，逐张追加去重、实时保存 rawCorpus；中途切 Tab 不串人格，单张失败不阻断其余
- 截图走独立 VLM 配置；OCR 结果自动填入 textarea，可编辑后再蒸馏
- 蒸馏 Prompt 提炼高频词 / 情绪节奏 / 共情逻辑 / 断句习惯，要求 300 字人格指令 + 2 个模拟问答案例，
  明确禁止输出原对话的人名与事件
- `memory-river:persona-profiles:v1` 保存 `instruction` + `rawCorpus`
- **`rawCorpus` 只用于编辑回显，聊天 Prompt 只读 `instruction`**
- 蒸馏失败不覆盖旧自定义；语料为空则清除 instruction，回退默认气质

**② 独立 VLM 配置**
- 设置面板 05：VLM Base URL / API Key / Model Name
- `visionModel` 非空 → 优先独立 VLM（Base/Key 留空则跟随聊天配置）
- `visionModel` 为空 → 自动回退聊天模型；不支持看图时只提示失败，不影响聊天
- 聊天与 VLM 各有独立熔断，截图失败不会锁死对话

**③ 动态热梗库**
- 设置面板 07：虚线框支持拖拽 / 点击 / 粘贴截图
- VLM Prompt 强制只输出 JSON 数组：`[{"word":"扎啤","meaning":"..."}]`
- `try/catch JSON.parse` → 校验 → 按 word 去重合并 → `memory-river:meme-library:v1`
- 聊天时注入最近 40 条热梗，Prompt 不膨胀

**④ 验证**
- 用 mock fetch 跑通：OCR → 蒸馏 → localStorage → System Prompt
- 断言 `promptLeaksRaw: false`、`promptHasInstruction: true`、`promptHasMeme: true`
- VLM 配置回退规则实测：无独立 Model 走聊天、部分填跟随聊天、完整填用独立

## 24. API Key 真实联网校验（2026-10-19，用户指令）

- 设置面板的聊天 Key / VLM Key 输入后 800ms 自动校验，结果只存在组件状态，不落 localStorage
- 优先 `GET /models`；404/405 时退化为一次 `max_tokens=1` 的 `/chat/completions` 鉴权请求
- 401/403 → 红叉；2xx → 绿勾；超时 / CORS / 断网 → 红叉并显示原因
- 每次输入变化取消上一次请求；图标可点击手动重试
- 校验使用独立请求，不重试、不写聊天 / VLM 熔断计数，不影响正常对话

## 25. 产品对话不再回落 Mock（2026-10-19，用户指令）

- 无 Key / Key 无效 / 离线 / 超时 / CORS → `sendChatMessage` 返回失败，不生成 persona 回复
- 用户消息保留，UI 提示失败，可重试
- `apiStatus`（online / offline / invalid / no-key / unknown）驱动输入框禁用与提示
- Mock 只保留给开发探针：`allowLocalMock` 参数或 DEV 下 `?mockChat=1` / `?chatSim=1` / `?chatPanel=1`
- 生产构建 `import.meta.env.DEV === false`，永远不启用 Mock

## 26. 照片绑定音乐 + 低频驱动（2026-10-19，阶段 A）

- `PhotoMemory.audio` 一张照片最多一首；重新绑定覆盖，删除时 revoke object URL
- L2 底部「配乐」胶囊：本地文件或 http/https URL
- `MusicEngine.setTrack()`：AudioBufferSource loop；旧曲淡出并停止后才启动新曲，绝不重叠
- `musicBus` 负责 L2 进退（1.8s / 1.2s）；`trackBus` 负责切歌（500ms / 800ms）
- 无配乐 / 解码失败 / CORS 失败 → 完全静音，不再回退程序化音景
- 低频新增 `MUSIC.drive.lowToWaveAmp`：`uWaveAmp/uWaveAmp2` 随鼓点增大
- 阶段 B（未做）：星尘高频逐星闪烁、当前歌曲注入 AI Prompt

## 27. AI 连发多条消息（2026-10-19，用户选择 B + 分隔符）

- 人格蒸馏新增“断句与连发习惯”：一条一句 / 短句连发 / 一条讲完等，写进 instruction
- 聊天 System Prompt 增加轻量协议：多条消息用单独一行 `<<<MSG>>>` 分隔，不解释、不包代码块
- 解析器 `src/ai/bubbles.ts`：`parseReplyBubbles()` 拆分，`replyTextFromBubbles()` 还原完整文本
- `ChatTurn.bubbles?: string[]` 仅用于 UI；`text` 始终是完整回复，供记忆/检索/TTS
- 一个 turn 可渲染多条气泡，间隔 `AI.ui.bubbles.replyDelayMs = 300ms`
- TTS 延迟到最后一条气泡出现后开始；新回复会取消旧计时
- 无分隔符 / 空段 / 单句 → 安全回退单气泡

## 28. 照片 VLM 识图 + 可选择的视觉服务商（2026-10-19，用户指令）

- VLM 配置改成和聊天 LLM 一样的「服务商 + 模型下拉」；只展示有视觉模型的服务商，自定义可手填
- 新增 `visionProviderId` / `visionHighQuality` / `visionAutoAnalyze`；高清和自动识图默认开启
- 高清照片：2800px / JPEG 0.95 / `detail: high`；截图：2400px PNG；失败降级 2048px JPEG 0.92
- 导入后串行分析照片：`PhotoVlmAnalysis` 存入 `PhotoMemory.vlm`，读取后使切片缓存失效
- 聊天 Prompt 优先注入 VLM 的 summary / scene / objects / lighting / visibleText / uncertain
- 没有可用 VLM（visionModel 为空或没有 Key）时：不自动请求、L2 不显示识图入口、不出现“未安装/未识图”文案
- 请求失败显示「识图失败 · 重试」；聊天回退像素统计标签
- 手动重试 `reanalyzePhoto(photoId)`；删除照片时丢弃未返回结果

## 29. L2 捏合锁定 + 移除食指光标（2026-10-19，用户指令）

- L2 捏合 → `lockToggle`；再次捏合解锁
- 锁定期间忽略：扇风、静止张合缩放、快速/保持握拳进入与退出
- 锁定瞬间停止滚动惯性并吸附到当前照片；相机目标固定在 L2
- 鼠标滚轮 / 拖拽 / 点击 / Esc / × 仍可用；离开 L2 自动解锁
- `l2Locked` 存入 store，不持久化；L0/L1 写入时自动清除
- `GestureOverlay` 移除食指柔光点、核心白点、拖尾与拨动扩散圈；保留焦点环和张开度弧
- `CameraPreview` 移除食指尖高亮，保留骨架、状态与 openness 读数


## 30. 校准按钮点击 + 捏合阈值放宽（2026-10-19，用户反馈）

- **校准按钮按不动**：L2 底部对话栏是整行 z-50 且 `pointer-events-auto`，栏变高后盖住左下角 CameraPreview 的「校准手势」按钮。
  - 修法：对话栏整条改 `pointer-events-none`，只有右侧控件容器 `pointer-events-auto`。
  - 校准浮层 portal 的 z-index 提到 `z-[85]`。
  - 回归 `?hitTest=calib-open`：`clickable: true`。
- **捏合太紧**：`GESTURE.pinch.distanceThreshold` 0.05 → **0.1**；仍然连续 3 帧确认，`releaseRatio 1.6` 防抖。
- 摄像头小窗新增实时 `捏 x.xxx` 读数，低于阈值变金色。


## 31. 锁定/解锁 3 秒冷却（2026-10-19，用户指令）

- `GESTURE.lock.cooldownMs = 3000`
- 状态机记录 `lastLockToggleAt`：成功锁/解锁后 3 秒内，L2 捏合完全忽略
- 离开 L2（显式或派生层级）自动解锁并重置冷却
- store 增加 `l2LockCooldownUntil`；Dialogue 显示：
  - 锁定中：`已锁定 · 2s 后可解锁`
  - 已解锁冷却：`锁定冷却 2s`
  - 冷却结束自动消失
- 回归：`?hitTest=calib-open` 仍 clickable；`pinch=0.08` 触发、`0.12` 不触发。


## 32. 手势摄像头坞移到右上角（2026-10-19，用户指令）

- `CameraPreview` 从左下角 `bottom-24 left-6` 移到右上角标题栏下方 `top-[92px] right-6`
- 桌面默认展开为紧凑玻璃卡片（208px），包含状态、骨架、open/ratio/扇/捏、校准
- 进入 L2 自动收成右上角状态胶囊；点击胶囊可临时展开，离开 L2 自动恢复展开
- 窄屏（<900）默认胶囊
- 左下角完全让给缩略图与 HUD 页脚，避免重叠
- 对话栏改为 `pointer-events-none`，只有右侧控件接收点击；校准按钮 `?hitTest=calib-open` 保持可点


## 33. 开场 Splash「溯光」+ 摄像框移到左上角（2026-10-19，用户指令）

- 项目 HUD 标题与 Splash 统一改为「溯光」
- Splash：居中 2s → 1.5s opacity 淡出 → 从 DOM 移除；始终 `pointer-events-none`，`z-[70]`
- 副标题：`Memory River · 拨动星辰，打捞过去的时间`
- DEV 探针 / `?splash=0` 自动跳过 Splash，避免截图黑屏
- 手势摄像头坞从右上角移到左上角标题下方 `left-6 top-[92px]`；桌面展开、L2/窄屏自动胶囊、点击可展开


## 34. L2 收起摄像头黑屏修复（2026-10-19，真机反馈）

- 根因：L2 自动收起时 `CameraPreview` 直接 `return` 胶囊，把 `<video>` 从 DOM 卸载；展开时只重新 append，没有 `play()`，且 `ready` 一直为 true。
- 修法：
  - 展开卡片始终挂载，收起只 `opacity-0` + `pointer-events-none` + `aria-hidden`；video 永不 detach。
  - attach 循环发现 `video.paused` 自动 `play()`；`visibilitychange` 与展开时再检查一次。
  - `ready` 根据 `video.readyState >= 2 && !video.paused` 实时更新。
  - tracker 监听 stream track `ended`、video `error` / `pause` / `stalled`，真正断流时切 `unavailable`。
- 验证：L2 收起后 video `paused:false / readyState:4`；展开后画面正常；无控制台错误。

## 35. 识图失败排查与兼容修复（2026-10-19）

排查发现两个高风险点：

1. **VLM Key 跨服务商误用**
   - 旧逻辑：VLM Key 留空时无条件跟随聊天 Key
   - 若聊天是 DeepSeek，VLM 选 OpenAI/Qwen，会把 DeepSeek Key 发到另一家 → 401
   - 修法：只有 VLM 与聊天 **Base URL 完全相同**时才允许跟随聊天 Key；不同服务商必须单独填 VLM Key
   - 设置面板增加警告与“实际请求 URL + 模型”提示

2. **400 错误被当成可重试错误**
   - 旧逻辑：480/400 等确定性错误会重试，并在 fallback 之前触发视觉熔断
   - 修法：4xx（429 除外）立即跳出重试，交给上层 fallback
   - 照片识别自动三档降级：
     1. 2800px + `detail: high` + 1800 tokens
     2. 2048px + `detail: auto` + 1200 tokens
     3. 2048px + 省略 `detail` + 1000 tokens
   - 仍失败时 `console.warn('[VLM] photo analysis failed', { model, reason })`（不含 Key/图片）


## 36. 识图失败最终定位：智谱 CORS → 改用 DeepSeek Vision（2026-10-20）

- 实际配置：聊天 DeepSeek，VLM 智谱 GLM-4V-plus，VLM Key 已填
- 实际错误：Safari `Load failed`
- 根因：智谱 `open.bigmodel.cn` 的 CORS 预检没有 `Access-Control-Allow-Origin/Headers/Methods`，浏览器直连被拦截
- DeepSeek 官方支持图片输入：`deepseek-flash`（V4.1 Flash），旧名 `deepseek-v4-flash-vision-exp` 仍接受
- DeepSeek `/v1/chat/completions` 的 CORS 允许 `http://localhost:5273`
- 配置新增 DeepSeek 视觉模型：`deepseek-flash` / `deepseek-v4-flash-vision-exp`
- 真实链路验证：demo 照片 → `status: ready`、`model: deepseek-flash`、summary 正确
- VLM 网络错误现在会翻译成明确中文（CORS/401/404/429），不再只显示 `Load failed`


## 37. 默认静音、可选音色与捏合放宽（2026-10-21）

- 用户反馈系统 TTS 听起来太机械，但希望保留朗读能力
- `AI.tts.enabled` 默认从 `true` 改为 `false`：进入应用不再自动出声
- 设置面板「语音」新增朗读音色下拉：
  - 系统自动（`pickVoice()` 的拟人度评分）
  - 系统实际可用的中文音色（本机 Safari：婷婷 zh-CN / 美嘉 zh-TW）
  - 「试听」按钮，忽略朗读开关，方便先选再开
- 选择持久化到 `memory-river:tts-voice`；找不到时自动回落到自动挑选
- 第三方 TTS 配置保留；试听只用系统音色
- 捏合阈值 `distanceThreshold` 0.1 → 0.15，连续 3 帧确认；回滞松开阈值 0.24


## 38. DeepSeek Flash 识图空结果：关闭 Thinking + 纯文本兜底（2026-10-21）

- 现象：4 张照片里 3 张 ready，足球场人群那张报 `empty vision completion`
- 数据：`visionModel=deepseek-flash`、Key 正常、HTTP 正常，只是 `choices[0].message.content` 为空
- 根因：DeepSeek Flash 默认开启 Thinking（effort=high），复杂图片的思考 token 吃满 `max_tokens=1800`，最终 content 为空
- 修法：
  - `runtime.ts` 对 `deepseek-flash` / `deepseek-v4-flash-*` 请求加 `thinking: { type: 'disabled' }`
  - 聊天与 VLM 都生效；`deepseek-reasoner` 保留思考
  - `vlmVision.ts` 对 `empty vision completion` 再加一层纯文本 Prompt 兜底（`maxTokens 600`）
- 真实验证（用户足球场原图，2048px）：
  - `status: ready`
  - summary：`一群穿运动服的人在绿色场地上围拢拥抱，背景是铁丝网和暖光下的植物。`
  - chat：`看起来像是一群人在运动场上抱在一起 / 穿的都是运动服 / 背景有铁丝网 / 有点像比赛结束后的拥抱`
- 注意：照片只存在内存，HMR/刷新会清空；验证时需重新导入


## 39. 滑动期间冻结连续缩放（2026-10-21）

- 用户反馈：扇风/滑动长河时仍会放大缩小，操作不干净
- 旧逻辑只有扇风事件后的 `zoomFreezeMs=320`，覆盖不到惯性滑行与自动吸附
- 修法：
  - Stage 在 `updateScroll` 中发布 `isSwiping`：只要还有真实位移/速度/吸附追赶，就为 true
  - 停稳后再保持 180ms（`GESTURE.flick.zoomFreezeAfterScrollMs`）
  - 不能只看 `snapTarget !== null`：吸附结束后下一帧会重新设成"当前位置"，否则会永久冻结
  - 手势状态机新增 `scrollActive`，并入 `zoomLocked`；滑动期间不更新连续缩放目标
- 离散手势（捏合、快速握拳、握拳退出、L2 锁定）不受影响
- 摄像头状态胶囊从「锁定」改为「缩放暂停」，避免和 L2 手势锁定混淆


## 40. 热梗截图支持多选（2026-10-21）

- 热梗区原来只处理文件选择 / 拖拽 / 粘贴的第一张
- 文件 input 加 `multiple`；拖拽和粘贴改为读取全部图片
- `imageInput.ts` 新增 `imagesFromClipboard` / `imagesFromDataTransfer`，旧单图函数保留为取第一张
- 多张截图串行识别，避免并发限流；每张识别完立即合并入库
- 进度显示「正在识别第 N/M 张…」
- 汇总：成功张数、识别梗数、新增、更新、失败原因；致命错误（无 Key / 熔断 / 401 / 403）停止后续请求
- 单张成功保留原来的「成功学会新梗：…」文案


## 41. 热梗只在幽默损友 + 轻松语境启用（2026-10-21）

- 用户反馈：截图学会了热梗，但聊天完全不用
- 排查：Prompt 确实包含热梗，但一次塞了 40 条，且只写「可以自然使用」；温柔老友更容易忽略
- 修法：
  - 只有 `persona.id === 'humor'` 才注入热梗；其他人设完全不注入
  - 当前用户输入命中 `sad / tired / lonely / afraid` 时不注入
  - 候选从 40 条降到 8 条（`maxMemePromptEntries`）
  - 候选按当前用户输入的二元组相关度排序，最相关的排第一（例如「抽象」会优先选到「抽象」「扎啤」）
  - 过滤明显擦边的词条，避免模型拿到不适合自然接话的内容
  - Prompt 改成明确的「本轮必须用热梗」：至少 1 个、最多 1 个、优先第一个、不解释、不硬堆
  - 热梗段落移到画面资料与跨图检索之后，减少被长上下文淹没
- 真实链路验证：幽默损友 +「哈哈今天也太抽象了」→ 回复自然用了「抽象」


## 42. 摄像头手动收起后保持胶囊（2026-10-21）

- 用户反馈：手动把摄像头收成胶囊后，切层 / resize 又自动展开
- 旧逻辑：`layer` 变化或窗口变宽时无条件 `setExpanded(true)`（L2 除外）
- 修法：
  - 增加 `manualCollapsedRef`，点击收起置 true，点击胶囊置 false
  - `layer` 自动展开与 resize 自动展开都先检查该标记
  - 手动收起状态持久化到 `memory-river:camera-collapsed:v1`
  - 刷新后仍保持胶囊；点胶囊展开并清除持久化
- 保留原有 L2 自动收起；手动收起优先级更高
