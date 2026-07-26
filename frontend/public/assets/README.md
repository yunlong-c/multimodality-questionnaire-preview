该目录现在由 `frontend/scripts/generate_official_manifest.py` 在构建前自动同步正式刺激素材。

当前约定：

- 原始正式材料仍保留在 `D:\multimodality\多模态问卷材料`
- 前端只复制浏览器运行所需的 `.png` / `.gif` 刺激文件到本目录
- `ui/example.png` 继续作为前端静态说明素材保留

生成后的正式素材路径示例：

- `assets/Pool_1/Pool_1_Graph/...`
- `assets/Pool_2/Pool_2_Video_fast/...`
- `assets/Pool_3/Pool_3_Table/...`
- `assets/Pool_4/Pool_4_Graph/...`
