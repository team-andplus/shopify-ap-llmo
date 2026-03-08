# 壁打ち：API Key で AI 利用するときのテスト — Shopify アプリ申請でどう処理するか

OpenAI 等の API Key を「ストアオーナーがアプリ設定でセットすると AI 生成できる」機能がある場合、**Shopify のアプリ審査**で審査員がどうテストするか・どう対応するかを整理する。

---

## Shopify の審査で言われていること

[Pass app review](https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review) より:

- **App Testing** の「Common app review problems」に次の記載がある:
  - **Reason**: "The app is submitted without proper **testing instructions or credentials**"
  - **Solution**: "Ensure that you include **testing information and test credentials** in the **app submission form**. Include a short **screencast** of how your app should work."
  - Failure 時は **app re-submit** が必要（Yes）。

→ 審査に必要な**テスト手順**と**テスト用の認証情報**を提出フォームに書く必要がある。第三者の API（OpenAI）を使う場合、「審査員が AI 機能を試すにはどうするか」を明示する必要がある。

---

## 取りうる対応パターン

| パターン | 内容 | 審査での扱い | 注意点 |
|----------|------|----------------|----------|
| **A. Key なしでも完結する設計** | API Key は**任意**。未設定なら「プロンプト機械生成 → 表示・コピー」まで。Key をセットしたときだけ「AI 生成」ボタンが有効になり、API を呼ぶ。 | 審査員は **Key なし**でインストールし、プロンプト生成・コピー・llms.txt ひな形作成など**主要フロー**を確認できる。AI 生成だけ「任意機能」として、提出フォームに「AI 生成を試す場合は、審査員ご自身の OpenAI API Key を設定してください」と書く。 | 審査員が Key を入れない限り「AI 生成」はテストされない。不具合があっても「オプション機能」として通る可能性はあるが、提出時に説明を書いておく。 |
| **B. テスト用 API Key を提出** | 開発者側で**審査専用の OpenAI API Key**（利用上限を絞ったもの）を用意し、提出フォームの「test credentials」に記載する。 | 審査員がその Key をアプリ設定に入れ、AI 生成まで一通りテストできる。 | Key の漏洩・使い捨てコスト。審査後は Key をローテーションした方がよい。 |
| **C. スクリーンキャストで代用** | 「プロンプト生成 → 設定に Key 入力 → AI 生成 → 採用で llms.txt 更新」の流れを**動画で撮り、提出時に添付**する。審査フォームに「AI 機能はスクリーンキャストで動作確認済み。実機で試す場合は上記の通り Key を設定してください」と書く。 | 審査員が Key を用意しない場合でも、動画で機能の存在と流れを示せる。 | 実機で AI を動かさない審査になる可能性。問題があれば「実機テストしてください」と返ってくることもある。 |

---

## 推奨の組み合わせ

1. **設計は A にする**  
   API Key は**任意**。未設定時は「プロンプト機械生成」まで。これで **Key なしでもアプリの主要価値（プロンプト生成・llms.txt ひな形・head の link）が審査可能**。

2. **提出フォームに書くこと**  
   - **Testing instructions**: 「llms.txt 用のプロンプト生成と link の出力は API Key 不要でご確認いただけます。AI による文章生成をご試用になる場合は、設定画面で OpenAI API Key（ご自身のもの）を入力してください。」
   - **Test credentials**: 「OpenAI API Key はお客様ご自身で取得・設定するオプション機能のため、審査用の共通 Key は用意しておりません。プロンプト生成と link 出力で主要動作をご確認ください。」  
   - または、審査用に**一時的なテスト用 Key を発行し**（B）、ここに記載。審査通過後に Key を無効化。

3. **スクリーンキャスト（C）**  
   「設定に Key を入れる → AI 生成ボタン → 文章が表示 → 採用で llms.txt 更新」まで 1 本の動画を用意し、提出時に添付。審査員が実機で Key を設定しない場合の補足になる。

4. **セキュリティ**  
   [Shopify / OpenAI のベストプラクティス](https://shopify.dev/docs/apps/launch/app-store-review/pass-app-review) と同様、**API Key はクライアントに露出させず、バックエンドのみで保持・使用**する。設定画面で入力された Key は暗号化して DB に保存。

---

## まとめ（一言）

- Shopify は **「testing information and test credentials」を提出フォームに含めよ**と言っている。
- **API Key は任意**にし、Key なしでも「プロンプト機械生成」まで動く設計にすれば、審査員は Key なしで主要機能を確認できる。
- 提出時は「AI 生成はオプション。試す場合は審査員の Key を設定してください」と明記するか、**審査用のテスト Key を一時的に用意**して credentials に載せるかのどちらか。スクリーンキャストで AI 生成の流れを示しておくと安心。
