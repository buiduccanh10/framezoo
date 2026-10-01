# Đánh giá bảo mật: betamovie

## Phạm vi

Rà soát mã nguồn toàn bộ repository, bao gồm API backend, xác thực, điều khiển sao lưu/tác vụ, provider addon/phụ đề, cập nhật/IPC Electron, lưu trữ/ký ứng dụng di động và triển khai CI/container.

- Chế độ quét: repository
- Loại mục tiêu: git_revision
- ID mục tiêu: `target_sha256_7e69fa467e6c022beae59e4d0e1d101c913c61ea65a7ec7888aff515d237877d`
- Revision: `fe8a2352ff50518616b2f0821be96aaa01a2db2c`
- Chiến lược kiểm kê: repository
- Đường dẫn bao gồm: `.`
- Đường dẫn loại trừ: không có
- Trạng thái runtime/test: chưa thực thi

### Hạn chế và loại trừ

- Không thực hiện kiểm tra runtime trực tiếp, triển khai đã xác thực, mạng, cập nhật hoặc thiết bị.
- Phạm vi bao phủ một phần: đã rà soát bảo mật tập trung trên các bề mặt nêu trên; phần kiểm kê còn lại chưa được đánh giá độc lập.

### Tóm tắt quét

| Trường | Giá trị |
| --- | --- |
| Kết quả quét | hoàn tất |
| Phát hiện cần báo cáo | 19 |
| Phân bố mức độ | cao: 10, trung bình: 7, thấp: 2 |
| Phân bố độ tin cậy | cao: 17, trung bình: 2 |
| Độ bao phủ | một phần |
| Chế độ xác thực | mã nguồn |

Artifact chuẩn: `scan-manifest.json`, `findings.json` và `coverage.json`. Báo cáo này là bản chiếu xác định từ các tệp đó.

## Mô hình đe dọa

Framezoo cung cấp API HTTP công khai và xác thực, điều khiển sao lưu/tác vụ quản trị, luồng IPC/cập nhật Electron, client di động và hạ tầng CI/CD.

### Tài sản

- Tài khoản và phiên người dùng
- Thông tin xác thực provider
- Cơ sở dữ liệu và bản sao lưu
- Artifact cập nhật desktop
- Khả năng native của desktop
- Thông tin xác thực triển khai CI

### Ranh giới tin cậy

- Internet đến backend
- Người dùng đã xác thực đến dữ liệu tenant
- Renderer đến tiến trình chính Electron
- Bộ nhớ di động đến thiết bị
- CI đến máy chủ triển khai
- Container đến Docker host

### Khả năng của kẻ tấn công

- Client chưa xác thực
- Người dùng thông thường đã xác thực
- Provider độc hại
- Renderer bị xâm nhập
- Thông tin xác thực phát hành/triển khai bị xâm nhập
- Kẻ tấn công MITM/DNS

### Mục tiêu bảo mật

- Phân quyền
- Bảo mật thông tin xác thực
- Giới hạn tài nguyên
- Tính toàn vẹn của cập nhật/native
- Tính toàn vẹn của triển khai và host

## Các phát hiện

| Phát hiện | Mức độ | Độ tin cậy |
| --- | --- | --- |
| Container reverse-proxy và ACME mount Docker socket | cao | cao |
| JWT admin dùng secret hard-code dự phòng | cao | cao |
| Updater macOS cài ZIP chưa xác minh và ký ad-hoc | cao | cao |
| Addon proxy truy cập mạng riêng qua redirect hoặc kiểm tra host chưa đầy đủ | cao | cao |
| Mọi user đã xác thực đều gọi được tác vụ Nitro đặc quyền | cao | cao |
| Import backup giải nén tar không kiểm tra containment | cao | cao |
| Ứng dụng mobile lưu credential và seed dạng rõ trong AsyncStorage | cao | cao |
| Windows libmpv SDK được tải động không kiểm tra toàn vẹn | cao | cao |
| Bản build Android release dùng debug keystore và mật khẩu mặc định | cao | cao |
| CI chấp nhận host triển khai qua ssh-keyscan chưa xác thực | cao | cao |
| Addon proxy đệm response chunked quá lớn trước khi áp hạn mức | trung bình | cao |
| Rate limit căn chỉnh phụ đề tin claim JWT do attacker kiểm soát | trung bình | cao |
| CORS có credential phản chiếu wildcard hoặc origin local | trung bình | trung bình |
| Electron extension IPC cho phép request mạng tùy ý và chặn header toàn session | trung bình | trung bình |
| Credential provider của user bị ghi vào log ứng dụng | trung bình | cao |
| CI action và Docker base image dùng tag có thể thay đổi | trung bình | cao |
| Xoay refresh token kiểm tra rồi cập nhật không nguyên tử | trung bình | cao |
| GET profile tiết lộ email user khác trước khi kiểm tra quyền sở hữu | thấp | cao |
| Input ngôn ngữ phụ đề gây fan-out upstream quá mức | thấp | cao |

### Thang độ tin cậy

- **Cao:** bằng chứng trực tiếp hỗ trợ phát hiện, không có trở ngại chưa giải quyết đáng kể.
- **Trung bình:** bằng chứng ủng hộ vấn đề có khả năng xảy ra, nhưng còn thiếu chứng minh runtime hoặc khả năng tiếp cận thực tế.
- **Thấp:** bằng chứng chưa đầy đủ; chỉ giữ lại để theo dõi rõ ràng.

## Chi tiết phát hiện

### [1] Container reverse-proxy và ACME mount Docker socket

- **Mức độ/độ tin cậy:** cao/cao
- **Danh mục/CWE:** container-escape / CWE-250
- **Dòng ảnh hưởng:** `ops/nginx-proxy/docker-compose.yml:5`
- **Tóm tắt:** Container proxy và ACME có quyền truy cập Docker API; mount chỉ đọc không loại bỏ khả năng tương đương root.
- **Bằng chứng:** `- /var/run/docker.sock:/tmp/docker.sock:ro`
- **Luồng dữ liệu:** Thành phần proxy/ACME bị xâm nhập sử dụng Docker API, dẫn tới container đặc quyền, mount host và thoát host.
- **Khả năng tiếp cận:** Cần xâm nhập thành phần.
- **Khắc phục:** Dùng socket proxy giới hạn hoặc daemon rootless cô lập. Thêm kiểm thử hồi quy chứng minh input bị từ chối/cô lập/kiểm tra toàn vẹn.

### [2] JWT admin ký và xác minh bằng secret hard-code dự phòng

- **Mức độ/độ tin cậy:** cao/cao
- **Danh mục/CWE:** hardcoded-credential / CWE-321
- **Dòng ảnh hưởng:** `framezoo-be/server/api/backup/login.post.ts:28`
- **Tóm tắt:** Đăng nhập và xác minh admin dùng literal `fallback-secret` khi `CRYPTO_SECRET` không được thiết lập.
- **Bằng chứng:** `const secret = process.env.CRYPTO_SECRET || 'fallback-secret';`
- **Luồng dữ liệu:** Khi thiếu secret, attacker ký JWT `env-admin`, giả mạo quyền truy cập các route backup.
- **Khả năng tiếp cận:** Cần cấu hình triển khai sai.
- **Khắc phục:** Bỏ fallback; fail closed khi thiếu `CRYPTO_SECRET`.

### [3] Updater macOS cài ZIP chưa xác minh và ký ad-hoc

- **Mức độ/độ tin cậy:** cao/cao
- **Danh mục/CWE:** software-integrity / CWE-494
- **Dòng ảnh hưởng:** `framezoo-desktop/src/desktopAppUpdater.ts:213`
- **Tóm tắt:** Updater tải và cài byte phát hành mà không xác minh hash/chữ ký/notarization, sau đó ký ad-hoc và chạy.
- **Bằng chứng:** `unzip -q -o ZIP; xattr -cr; codesign --force --deep -s -`
- **Luồng dữ liệu:** Artifact cập nhật bị xâm nhập được thực thi khi user chấp nhận cập nhật; có thể dẫn tới thực thi mã tùy ý.
- **Khả năng tiếp cận:** Cần xâm nhập nguồn cập nhật.
- **Khắc phục:** Xác minh artifact đã ký/notarized hoặc SHA-256 trước khi giải nén; giữ khả năng rollback.

### [4] Addon proxy truy cập mạng riêng qua redirect hoặc kiểm tra host chưa đầy đủ

- **Mức độ/độ tin cậy:** cao/cao
- **Danh mục/CWE:** SSRF / CWE-918
- **Dòng ảnh hưởng:** `framezoo-be/server/routes/addon/proxy.get.ts:84`
- **Tóm tắt:** `/addon/proxy` không xác thực yêu cầu đăng nhập chỉ kiểm tra hostname ban đầu và theo redirect mà không xác minh đích mới.
- **Bằng chứng:** `response = await fetch(targetUrl.toString(), {`
- **Luồng dữ liệu:** Request proxy công khai đi qua redirector hoặc IP phân giải vào mạng nội bộ, làm lộ request/response nội bộ.
- **Khả năng tiếp cận:** Route công khai; chính sách egress có thể giảm tác động.
- **Khắc phục:** Allowlist upstream rõ ràng; xác minh mọi redirect và IP đã phân giải; tắt redirect tự động.

### [5] Mọi user đã xác thực đều gọi được tác vụ Nitro đặc quyền

- **Mức độ/độ tin cậy:** cao/cao
- **Danh mục/CWE:** missing-authorization / CWE-862
- **Dòng ảnh hưởng:** `framezoo-be/server/api/jobs/run.post.ts:18`
- **Tóm tắt:** `/api/jobs/run` nhận `job` tùy ý và gọi `runTask()` mà không yêu cầu quyền admin/internal.
- **Bằng chứng:** `const result = await runTask(jobName, {`
- **Luồng dữ liệu:** Tài khoản thường gọi `backup:daily` hoặc tác vụ xóa metric, gây sao lưu trái phép, cạn tài nguyên hoặc reset dữ liệu phá hủy.
- **Khả năng tiếp cận:** Cần phiên user hợp lệ.
- **Khắc phục:** Yêu cầu phân quyền admin/internal và allowlist cố định.

### [6] Import backup giải nén tar không kiểm tra containment

- **Mức độ/độ tin cậy:** cao/cao
- **Danh mục/CWE:** path-traversal / CWE-22
- **Dòng ảnh hưởng:** `framezoo-be/server/utils/backup.ts:301`
- **Tóm tắt:** Archive `.tar.gz` do admin tải lên được truyền vào `tar -xzf` mà không kiểm tra traversal, link, device hoặc kích thước.
- **Bằng chứng:** `const extractCmd = \`cd ${tempDir} && tar -xzf ${safeFilename}\`;`
- **Luồng dữ liệu:** Tar có entry traversal hoặc symlink có thể ghi đè file có quyền ghi hoặc làm cạn đĩa.
- **Khả năng tiếp cận:** Cần lộ credential admin.
- **Khắc phục:** Kiểm tra member; từ chối traversal/link; giới hạn kích thước; cô lập vùng giải nén.

### [7] Ứng dụng mobile lưu credential và seed dạng rõ trong AsyncStorage

- **Mức độ/độ tin cậy:** cao/cao
- **Danh mục/CWE:** sensitive-data-exposure / CWE-922
- **Dòng ảnh hưởng:** `framezoo-mobile/src/services/storage/storage.ts:8`
- **Tóm tắt:** Mô hình auth chứa token, refreshToken và seed; bootstrap lưu account qua AsyncStorage không mã hóa.
- **Bằng chứng:** `return AsyncStorage.setItem(key, JSON.stringify(value));`
- **Luồng dữ liệu:** Backup/root/forensics trên thiết bị đọc credential, dẫn tới chiếm phiên và lộ seed.
- **Khả năng tiếp cận:** Cần truy cập storage cấp thiết bị.
- **Khắc phục:** Dùng secure storage dựa trên Keychain/Keystore; tách dữ liệu profile.

### [8] Windows libmpv SDK tải động không kiểm tra toàn vẹn

- **Mức độ/độ tin cậy:** cao/cao
- **Danh mục/CWE:** software-integrity / CWE-494
- **Dòng ảnh hưởng:** `framezoo-desktop/scripts/fetch-windows-libmpv.mjs:108`
- **Tóm tắt:** Build chọn artifact upstream phù hợp rồi giải nén mà không dùng URL bất biến, hash hoặc chữ ký.
- **Bằng chứng:** `await execa('7z', ['x', '-y', archivePath, \`-o${outputDir}\`]);`
- **Luồng dữ liệu:** Response upstream bị xâm nhập cung cấp SDK độc hại trong CI; artifact desktop phát hành chứa native code do attacker kiểm soát.
- **Khắc phục:** Pin release bất biến; xác minh SHA-256/chữ ký trước khi giải nén.

### [9] Bản build Android release dùng debug keystore và mật khẩu mặc định

- **Mức độ/độ tin cậy:** cao/cao
- **Danh mục/CWE:** software-integrity / CWE-321
- **Dòng ảnh hưởng:** `framezoo-mobile/android/app/build.gradle:88`
- **Tóm tắt:** Ký release trỏ vào `signingConfigs.debug`; debug keystore với credential mặc định nằm trong cây ứng dụng.
- **Bằng chứng:** `release { signingConfig signingConfigs.debug }`
- **Luồng dữ liệu:** Bất kỳ ai có key trong repository đều ký APK cùng danh tính, cho phép giả mạo app hoặc thay thế bản cập nhật.
- **Khả năng tiếp cận:** Giả định app được phân phối ngoài môi trường phát triển.
- **Khắc phục:** Dùng production keystore ngoài repo qua secret CI; bỏ fallback debug.

### [10] CI chấp nhận host triển khai qua ssh-keyscan chưa xác thực

- **Mức độ/độ tin cậy:** cao/cao
- **Danh mục/CWE:** supply-chain / CWE-295
- **Dòng ảnh hưởng:** `.github/workflows/deploy-web.yml:63`
- **Tóm tắt:** Job tin host key do DNS/mạng trả về trước khi gửi secret môi trường và triển khai.
- **Bằng chứng:** `ssh-keyscan -p "$VPS_PORT" "$VPS_HOST" >> ~/.ssh/known_hosts`
- **Luồng dữ liệu:** MITM hoặc chiếm DNS được chấp nhận trước khi chuyển secret, dẫn tới lộ secret production và chiếm quyền triển khai.
- **Khắc phục:** Pin fingerprint host đã xác minh; bật strict checking; tránh truyền toàn bộ environment.

### [11] Addon proxy đệm response chunked quá lớn trước khi áp hạn mức

- **Mức độ/độ tin cậy:** trung bình/cao
- **Danh mục/CWE:** resource-exhaustion / CWE-400
- **Dòng ảnh hưởng:** `framezoo-be/server/routes/addon/proxy.get.ts:121`
- **Tóm tắt:** `response.arrayBuffer()` cấp phát toàn bộ response trước khi kiểm tra 5 MB nếu không có `content-length`.
- **Bằng chứng:** `const buffer = await response.arrayBuffer();`
- **Tác động:** Cạn bộ nhớ hoặc suy giảm dịch vụ.
- **Khắc phục:** Dùng stream đếm byte và hủy khi vượt hạn mức.

### [12] Rate limit căn chỉnh phụ đề tin claim JWT do attacker kiểm soát

- **Mức độ/độ tin cậy:** trung bình/cao
- **Danh mục/CWE:** resource-exhaustion / CWE-770
- **Dòng ảnh hưởng:** `framezoo-be/server/middleware/a-rate-limit.ts:124`
- **Tóm tắt:** Bộ giới hạn dùng `jwt.decode()` không xác minh và định danh bucket tốn kém bằng `gid`/`sid` do attacker chọn.
- **Bằng chứng:** `const decoded = jwt.decode(bearerToken) as { gid?: string; sid?: string } | null;`
- **Tác động:** Claim giả duy nhất né bucket căn chỉnh phụ đề, làm bão hòa CPU và slot inference.
- **Khắc phục:** Dùng identity đã xác minh hoặc IP đáng tin; không dùng claim chưa xác minh.

### [13] CORS có credential phản chiếu wildcard hoặc origin local

- **Mức độ/độ tin cậy:** trung bình/trung bình
- **Danh mục/CWE:** security-misconfiguration / CWE-942
- **Dòng ảnh hưởng:** `framezoo-be/server/utils/cors.ts:77`
- **Tóm tắt:** CORS chấp nhận `*`, `null` và origin local trong khi bật credential; tác động phụ thuộc cấu hình production.
- **Bằng chứng:** `if (allowedOrigins.has('*') || allowedOrigins.has(normalizedRequestOrigin)) {`
- **Tác động:** Lộ token cross-origin và CSRF.
- **Khắc phục:** Từ chối wildcard/null khi dùng credential; yêu cầu origin chính xác và biện pháp chống CSRF.

### [14] Electron extension IPC cho phép request mạng tùy ý và chặn header toàn session

- **Mức độ/độ tin cậy:** trung bình/trung bình
- **Danh mục/CWE:** SSRF / CWE-918
- **Dòng ảnh hưởng:** `framezoo-desktop/src/main.ts:627`
- **Tóm tắt:** IPC có thể gọi từ renderer nhận URL, method, header và body tùy ý mà không xác minh sender/frame origin.
- **Bằng chứng:** `fetch(payload.url, { method: payload.method, headers: payload.headers, body: payload.body })`
- **Tác động:** SSRF, chuyển tiếp credential hoặc thao túng traffic.
- **Khắc phục:** Xác minh origin/identity extension; allowlist đích và chặn dải IP riêng.

### [15] Credential provider của user bị ghi vào log ứng dụng

- **Mức độ/độ tin cậy:** trung bình/cao
- **Danh mục/CWE:** sensitive-data-exposure / CWE-532
- **Dòng ảnh hưởng:** `framezoo-be/server/routes/users/\[id\]/settings.ts:104`
- **Tóm tắt:** Log settings chứa raw body cùng object `updateData`/`createData` có secret.
- **Bằng chứng:** `log.info('Updating user settings', { userId, body });`
- **Tác động:** Người có quyền đọc log khôi phục credential và lạm dụng tài khoản bên ngoài.
- **Khắc phục:** Redact đệ quy secret; xoay credential đã bị ghi.

### [16] CI action và Docker base image dùng tag có thể thay đổi

- **Mức độ/độ tin cậy:** trung bình/cao
- **Danh mục/CWE:** software-integrity / CWE-829
- **Dòng ảnh hưởng:** `framezoo-be/Dockerfile:1`
- **Tóm tắt:** Input build/deploy tham chiếu tag di động thay vì commit hoặc digest bất biến.
- **Bằng chứng:** `FROM node:22-alpine`
- **Tác động:** Tag upstream bị đổi làm code chưa review đi vào CI hoặc production.
- **Khắc phục:** Pin action bằng SHA và image bằng digest; cập nhật qua automation đã review.

### [17] Xoay refresh token kiểm tra rồi cập nhật không nguyên tử

- **Mức độ/độ tin cậy:** trung bình/cao
- **Danh mục/CWE:** race-condition / CWE-362
- **Dòng ảnh hưởng:** `framezoo-be/server/utils/auth.ts:387`
- **Tóm tắt:** Code xác minh `refresh_jti` rồi cập nhật session vô điều kiện; reuse đồng thời có thể tạo nhiều cặp token.
- **Bằng chứng:** `const updatedSession = await prisma.sessions.update({`
- **Tác động:** Hai request đồng thời dùng một refresh token hợp lệ và nhận nhiều cặp access/refresh hợp lệ.
- **Khắc phục:** Dùng conditional update trên `refresh_jti` cũ hoặc row locking.

### [18] GET profile tiết lộ email user khác trước khi kiểm tra quyền sở hữu

- **Mức độ/độ tin cậy:** thấp/cao
- **Danh mục/CWE:** broken-access-control / CWE-639
- **Dòng ảnh hưởng:** `framezoo-be/server/routes/users/\[id\]/index.ts:33`
- **Tóm tắt:** GET trả email/profile trước khi kiểm tra sở hữu phiên như các mutation.
- **Bằng chứng:** `return { id: user.id, namespace: user.namespace, nickname: (user as any).nickname, email: user.email,`
- **Tác động:** User đã xác thực đoán UUID của user khác để làm lộ email/profile và enumerate.
- **Khắc phục:** Yêu cầu quyền owner hoặc chỉ trả projection công khai không có email.

### [19] Input ngôn ngữ phụ đề gây fan-out upstream quá mức

- **Mức độ/độ tin cậy:** thấp/cao
- **Danh mục/CWE:** resource-exhaustion / CWE-400
- **Dòng ảnh hưởng:** `framezoo-be/server/utils/subtitles/wyzie.ts:102`
- **Tóm tắt:** Route nhận danh sách ngôn ngữ không giới hạn; Wyzie thêm chunk cố định cho từng ID và fetch đồng thời mọi URL.
- **Bằng chứng:** `const responses = await Promise.allSettled(`
- **Tác động:** Client gửi nhiều giá trị ngôn ngữ, gây áp lực connection, CPU và timeout.
- **Khắc phục:** Giới hạn số ngôn ngữ và request upstream; dùng concurrency có giới hạn.

## Các bề mặt đã rà soát

| Bề mặt | Khu vực rủi ro | Kết quả | Ghi chú |
| --- | --- | --- | --- |
| Audit backend HTTP/xác thực/backup/addon | chưa ghi nhận | Đã báo cáo | Không có ghi chú chuẩn bổ sung. |
| Audit client desktop và mobile | chưa ghi nhận | Đã báo cáo | Không có ghi chú chuẩn bổ sung. |
| Audit CI, Docker và triển khai | chưa ghi nhận | Cần theo dõi | Không có ghi chú chuẩn bổ sung. |
| Audit backend nền | chưa ghi nhận | Cần theo dõi | Không có ghi chú chuẩn bổ sung. |

## Câu hỏi mở và việc cần làm

- Không tìm thấy `SECURITY.md` hoặc `threat-model.md` trong repository.
- Chưa thực hiện xác thực runtime, triển khai, mạng, cập nhật hoặc thiết bị.
- Khả năng khai thác CORS phụ thuộc `CORS_ALLOWED_ORIGINS` và cài đặt cookie production.
- Các file kiểm kê bổ sung chưa được rà soát bảo mật đầy đủ trong lần chạy này.
  - Việc cần làm: Rà soát unit trì hoãn `deferred-unreviewed-remainder` và hoàn tất khoảng trống bằng chứng.
- Phát hiện nền đang chờ xác thực từ parent:
  - `cand_public-addon-proxy-ssrf`
  - `cand_unbounded-addon-proxy-buffer`
  - `cand_unauthorized-task-dispatch`
  - `cand_unverified-rate-limit-identity`
  - `cand_credential-logging`
  - `cand_cross-user-profile-disclosure`

