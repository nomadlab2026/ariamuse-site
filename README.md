# Aria Muse — 个人网站

高端时尚风格的英文个人网站，包含大图作品集、滚动照片轮播、专辑预告、媒体平台跳转和联系方式。

**完全不需要写代码。** 所有内容都通过网页后台 `/admin/` 修改，改完点一下按钮就自动上线。

---

## 一、这个网站由什么组成

```
index.html              前台主页
admin/                  后台管理面板（改内容的地方）
data/site.json          你的所有内容（网站的数据来源）
data/admin.json         后台密码配置
assets/photos/gallery/  作品集大图
assets/photos/social/   滚动轮播小图
assets/css/             样式
assets/js/site.js       前台交互逻辑
assets/fonts/           自托管字体（国内访问更快）
.github/workflows/      一键部署配置
CNAME                   绑定域名 nomadlab.one
```

---

## 二、日常怎么改内容

1. 打开 `https://nomadlab.one/admin/`
2. 输入密码 `ariamuse2026`
3. 在 7 个标签页里改内容
4. 点右上角 **Save & Publish**
5. 约 1 分钟后网站自动更新

### 各标签页能改什么

| 标签页 | 内容 |
|---|---|
| **Basics** | 站名、标语、简介、关于我文字、数据统计 |
| **Hero** | 首页大图、标题、按钮、滚动新闻条 |
| **Release** | 专辑预告：标题、封面、发布日期（带倒计时）、试听链接 |
| **Photos** | 作品集和滚动轮播的照片（支持拖拽上传） |
| **Media** | 各平台跳转链接（Instagram / TikTok / YouTube / X / Fanvue / Spotify） |
| **Contact** | 联系方式邮箱、留言表单开关 |
| **Settings** | GitHub 账号、仓库、Token、修改后台密码 |

### 换照片的两种方式

**方式一：后台拖拽上传（推荐，最简单）**
1. 进 **Photos** 标签页
2. 把图片直接拖进虚线框，或点"choose files"选择
3. 先选目标：作品集网格 还是 滚动轮播
4. 图片会自动压缩并上传，几秒后出现在下方列表里
5. 点 **Save & Publish** 生效

**方式二：直接替换文件**
把新照片按同名规则放进对应目录，刷新页面即可：
- 作品集 → `assets/photos/gallery/look-01.jpg` ~ `look-12.jpg`
- 轮播 → `assets/photos/social/post-01.jpg` ~ `post-12.jpg`
- 首页大图 → `assets/photos/hero.jpg`
- 专辑封面 → `assets/photos/album-cover.jpg`
- 关于我配图 → `assets/photos/portrait.jpg`

> 原始素材 `FV-*.png`（艺术写真）和 `IG-*.png`（社交生活照）保留在项目根目录，
> 随时可以放进项目根目录运行 `python tools/prepare_photos.py` 重新生成压缩版。

---

## 三、后台密码和 GitHub Token

### 后台密码
默认 `ariamuse2026`。可在 **Settings → Change passcode** 修改。

### GitHub Token（后台保存内容用）
后台需要一次 GitHub 授权才能把修改写回仓库。创建方法：

1. 登录 GitHub → 右上角头像 → **Settings**
2. 左侧最下面 → **Developer settings**
3. 左侧 → **Personal access tokens** → **Tokens (classic)**
4. 点 **Generate new token (classic)**
5. 填写：
   - Note：`Aria Muse Site`
   - Expiration：`90 days`（到期后重新生成一次即可）
   - 勾选 **`repo`** （勾上就够，其他都不用勾）
6. 点 **Generate token**
7. 复制那串 `ghp_...`，粘贴到后台 **Settings → Personal access token**
8. 同时填好 **GitHub username**（`nomadlab2026`）和 **Repository name**（`ariamuse-site`）

> Token 只存在你自己浏览器的本地存储里，不会发送到任何第三方。
> 但请不要把这个 Token 分享给别人 —— 它等同于你仓库的写权限。

---

## 四、域名配置（nomadlab.one）

DNS 需要加以下记录（在你买域名的服务商后台操作）：

**主域名 `nomadlab.one`**

| 类型 | 主机记录 | 记录值 |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |

**www 子域名**

| 类型 | 主机记录 | 记录值 |
|---|---|---|
| CNAME | `www` | `nomadlab2026.github.io` |

配好后等 DNS 生效（通常几分钟到 48 小时），GitHub 会自动签发 HTTPS 证书。

> 如果想在仓库里换域名，改 `CNAME` 文件的内容，然后点 **Save & Publish**。

---

## 五、部署机制

- 代码推到 `main` 分支 → GitHub Actions 自动跑 `.github/workflows/deploy.yml`
- 工作流把 `index.html`、`admin/`、`assets/`、`data/`、`CNAME` 打包成 `_site/`
- 部署到 GitHub Pages

后台点 **Save & Publish** 会修改 `data/site.json` 并提交 → 触发同一条流水线 → 自动上线。

**手动触发：** GitHub 仓库 → **Actions** → **Deploy to GitHub Pages** → **Run workflow**

---

## 六、联系表单收不到邮件怎么办

默认情况下，访客点"发送"会打开他们自己的邮件客户端（写给你 `contact.email` 填的邮箱）。
这样不需要任何第三方服务，永远免费可用。

如果想用表单直接收到邮件，去 [formspree.io](https://formspree.io) 注册一个免费表单，
把生成的地址填进后台 **Contact → Formspree endpoint**，访客的留言就会直接进你的邮箱。

---

## 七、本地预览（可选）

```bash
cd "项目目录"
python -m http.server 8899
# 打开 http://127.0.0.1:8899
```

---

## 八、常见问题

**Q：后台提示 "Could not load data/site.json"**
A：先在 Settings 填好 GitHub username / Repository / Token，再点 Test connection。

**Q：点 Save & Publish 报 401 / 403**
A：Token 无效或过期了。重新按第三节生成一个 Token 粘贴进去。

**Q：点了 Publish 但网站没变**
A：正常要等 1 分钟左右（要跑一遍 CI）。可以在 GitHub 仓库的 Actions 页面看进度。

**Q：照片上传失败**
A：多半是 Token 没有仓库写权限。确认勾选了 `repo` scope。

**Q：想临时藏掉后台**
A：把 `admin/` 目录整个删掉再提交。恢复时再传回去即可。

---

*Built for Aria Muse · 2026*
