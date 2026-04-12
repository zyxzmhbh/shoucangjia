# 右划退出 (SillyTavern Extension)

## 功能

- 在聊天界面中，右划即可退出当前会话并返回首页/角色列表。
- 增强 Via 兼容：同时监听 `touch` 和 `pointer` 事件，并在识别为横向右划后尝试阻止默认行为。
- 输入框、文本编辑区不会触发，避免误触。

## 安装

在 SillyTavern 扩展里使用仓库地址安装：

`https://github.com/zyxzmhbh/youhua.git`

## 说明

- 若不同主题或版本的按钮选择器不同，扩展会自动尝试函数调用、按钮点击和 `history.back()` 三重回退。
