# ANKI_IMPORT_FEASIBILITY

结论：`FEASIBLE_AS_SEPARATE_ADAPTER / NOT_IMPLEMENTED_IN_V0.1`。

Anki 的核心抽象可映射为：Note → authoritative imported content，Card → ReviewCard，Deck → StudyCollection，Template → Adapter presentation。`.apkg` 是容器格式，通常还涉及 SQLite collection、media 映射、模板/字段模型与调度状态。直接把它并入当前 Generic Importer 会明显扩大解析、许可与安全面。

建议后续边界：

1. 只读 container inspector，先列出 schema/media/牌组元数据；
2. Note/Card/Template 显式映射策略，未知模板 fail closed；
3. 默认只导入内容，不导入 Anki 调度私有状态；
4. media 做 hash、尺寸、MIME 与路径穿越检查；
5. 来源与许可证进入 Generic Source Descriptor 和 Import Receipt；
6. 使用完全 synthetic `.apkg` fixture 做 parser boundary 测试。

本阶段未复制 Anki 源码、未安装 Anki、未下载 `.apkg`，运行时也不依赖 Anki。
