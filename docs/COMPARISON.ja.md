# 他ツールとの比較

Workbench とよく比較されるツールとの誠実な比較です。機能の判定は各プロジェクトの
2026 年 10 月時点の公式ドキュメント / リポジトリに基づき、リンクは表頭にあります。
Workbench 列は本リポジトリの現状であり、計画ではありません。

## 機能マトリクス

● あり · ◐ 部分的 / 間接的 · ○ なし

| | Workbench | [Mission Center](https://gitlab.com/mission-center-devs/mission-center) | [System Informer](https://systeminformer.com/) | [btop++](https://github.com/aristocratos/btop) | [Glances](https://github.com/nicolargo/glances) | [Stats](https://github.com/exelban/stats) | [ccusage](https://ccusage.com/) | [Claude Code Usage Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor) |
|---|---|---|---|---|---|---|---|---|
| プロセス一覧 | ● | ● | ● | ● | ● | ◐ | ○ | ○ |
| プロセスツリー | ● | ● | ● | ● | ○ | ○ | ○ | ○ |
| ポート → 所有プロセス | ● | ○ | ● | ○ | ◐ | ○ | ○ | ○ |
| 開発サーバー検出 | ● | ○ | ○ | ○ | ○ | ○ | ○ | ○ |
| プロジェクト登録 + タスク | ● | ○ | ○ | ○ | ○ | ○ | ◐ | ○ |
| AI セッションコスト台帳 | ● | ○ | ○ | ○ | ○ | ○ | ● | ● |
| 予算アラート | ● | ○ | ○ | ○ | ○ | ○ | ○ | ● |
| 管理者として終了 | ● | ○ | ● | ◐ | ◐ | ○ | ○ | ○ |
| トレイ + ログイン時起動 | ● | ○ | ● | ○ | ○ | ● | ○ | ○ |
| 明暗以上のテーマシステム | ● | ◐ | ◐ | ● | ◐ | ◐ | ○ | ○ |
| 3 言語以上の UI | ● | ● | ○ | ○ | ○ | ● | ○ | ○ |
| キーボードコマンドパレット | ● | ○ | ○ | ◐ | ○ | ○ | ◐ | ○ |
| CSV 書き出し | ● | ○ | ● | ◐ | ● | ○ | ● | ● |
| ブラウザ / Web モード | ●（ローカルでライブ） | ○ | ○ | ○ | ● | ● | ○ | ○ |
| プラグイン / 拡張 API | ○ | ○ | ● | ○ | ● | ○ | ◐ | ○ |
| 自動更新 | ○ | ○ | ● | ○ | ◐ | ● | ○ | ○ |
| ライセンス | MIT | GPL-3.0 | MIT | Apache-2.0 | LGPL-3.0 | MIT | MIT | MIT |

## 他ツールが優れている点

自画自賛は意味がありません。以下は相手が実際に優れている点です。

- **Mission Center** はマシン計測が Workbench より深い：スレッドごとの CPU、GPU（NVTOP）、
  ファン、センサー、そして子プロセスをアプリ単位に集約しつつツリーを保つ Apps ページ。
  Weblate で 45 言語を維持し、複数の Linux ディストリビューションにプリインストールされています。
  Workbench に GPU / センサーページはありません。
- **System Informer** は Windows のプロセス調査の事実上の標準：ハンドル、DLL、スタック、
  サービス、「Go to Process」付きの Network Stack、プラグイン API。Workbench が 1 プロセスに
  ついて見せる情報ははるかに少なく、ハンドルも見られません。
- **btop++** は常駐モニターとして優秀：極小のフットプリント、マウス対応、シグナル送信、
  41 のテーマファイル。Workbench は「開いて使うアプリ」であり、ターミナルに常駐させる TUI
  ではありません。
- **Glances** は自動化で優位：文書化された REST API、MCP サーバー、クライアント/サーバー
  モード、CSV/JSON 書き出し。Workbench に API もリモートモードもありません。
- **Stats** は macOS メニューバー監視の代表：13 種のメニューバーウィジェットと、外部 API が
  2 つだけであることを明記したプライバシー説明。Workbench の macOS ビルドは CI のみで未署名です。
- **ccusage** は 1 コマンドで 18 種のコーディングエージェントを集計し、`--instances` で
  プロジェクト別に集約できます。Workbench は Claude Code と Codex のセッションファイルのみ。
- **Claude Code Usage Monitor** は 5 時間ブロックの枯渇を予測し、`official` と
  `local_estimate` を区別します。Workbench は台帳行に measured / estimated / zero-pricing を
  付けますが、予測は行いません。

## Workbench が異なる点

1. **1 つのウィンドウで 3 層をつなぐ。** 待受ポートから所有プロセスへ移動でき、プロセス詳細は
   保持する全ポートを逆引き表示し、コスト台帳はその消費を生んだセッションファイルに結びつきます。
   上記のツールでマシン状態と AI セッションコストを結ぶものはありません。
2. **開発サーバーを理解する。** Vite、Next、Nuxt、Django、uvicorn、Rails など 30+ をコマンドライン
   から信頼度付きで判定し、裸のポートではなく「開発サーバー」として提示します。
3. **安全は説明ではなく実装。** 保護プロセス一覧は Rust 内にあり、終了直前に同一性を再検証し、
   UAC 昇格は都度承認・他プラットフォームでは拒否。環境チェックは実際に検証した内容を報告します。
4. **できないことを認める。** コード署名なし、自動更新なし、プラグイン API なし、リモート監視なし——
   これらは [ARCHITECTURE.ja.md](ARCHITECTURE.ja.md) のギャップ一覧に書かれています。

## 選び方

| 目的 | 選択 |
|---|---|
| Linux のハードウェア詳細計測 | Mission Center |
| Windows のプロセス調査 | System Informer |
| ターミナル常駐のモニター | btop++ / Glances |
| macOS メニューバー統計 | Stats |
| 複数 CLI のエージェントコスト | ccusage |
| Claude のクォータ予測 | Claude Code Usage Monitor |
| ポート + 開発サーバー + AI コストを 1 つのデスクトップアプリで | Workbench |
