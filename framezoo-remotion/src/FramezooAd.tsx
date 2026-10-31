import {
  AbsoluteFill,
  Easing,
  Img,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
} from "remotion";

const white = "#f7f7f4";
const muted = "#a6abb4";
const red = "#ed1c24";
const cyan = "#63d4e8";
const base = "#07090d";
const font = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const reveal = (frame: number, delay = 0) =>
  interpolate(frame, [delay, delay + 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

const Backdrop: React.FC<{ tint?: string }> = ({ tint = "#281015" }) => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(ellipse at 50% 48%, ${tint} 0%, transparent 51%), linear-gradient(155deg, #06070a 0%, #10131a 55%, #050607 100%)`,
    }}
  />
);

const Wordmark: React.FC<{ height?: number }> = ({ height = 54 }) => (
  <Img
    src={staticFile("framezoo-logo.svg")}
    style={{ height, width: "auto", objectFit: "contain" }}
  />
);

const Eyebrow: React.FC<{ children: React.ReactNode; color?: string }> = ({
  children,
  color = red,
}) => (
  <div style={{ color, fontSize: 21, fontWeight: 750, letterSpacing: 4, textTransform: "uppercase" }}>
    {children}
  </div>
);

const ScreenScene: React.FC<{
  index: string;
  eyebrow: string;
  title: React.ReactNode;
  detail: string;
  image: string;
  tags: string[];
  tint?: string;
  accent?: string;
}> = ({ index, eyebrow, title, detail, image, tags, tint, accent = cyan }) => {
  const frame = useCurrentFrame();
  const enter = reveal(frame, 3);
  const drift = interpolate(frame, [0, 300], [0.96, 1.035], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  return (
    <AbsoluteFill style={{ backgroundColor: base, color: white, fontFamily: font }}>
      <Backdrop tint={tint} />
      <div style={{ position: "absolute", left: 72, right: 60, top: 100, opacity: enter }}>
        <Eyebrow color={accent}>{index} · {eyebrow}</Eyebrow>
        <div style={{ marginTop: 24, fontSize: 62, fontWeight: 650, lineHeight: 1.04, letterSpacing: -2.5 }}>
          {title}
        </div>
        <div style={{ marginTop: 18, color: muted, fontSize: 25, lineHeight: 1.35 }}>{detail}</div>
      </div>
      <div style={{ position: "absolute", left: 55, top: 560, width: 970, height: 625, opacity: enter, scale: drift, borderRadius: 28, overflow: "hidden", border: "1px solid rgba(255,255,255,.17)", boxShadow: "0 42px 100px rgba(0,0,0,.58)" }}>
        <Img src={staticFile(image)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
      <div style={{ position: "absolute", left: 72, right: 72, bottom: 170, display: "flex", flexWrap: "wrap", gap: 14, opacity: reveal(frame, 34) }}>
        {tags.map((tag, i) => (
          <div key={tag} style={{ padding: "13px 18px", border: "1px solid rgba(255,255,255,.15)", borderRadius: 999, background: "rgba(8,10,14,.76)", color: i % 2 ? muted : white, fontSize: 20, letterSpacing: 0.2 }}>
            {tag}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const Interlude: React.FC<{
  index: string;
  eyebrow: string;
  title: React.ReactNode;
  lines: string[];
  accent?: string;
  tint?: string;
  symbol?: string;
  image: string;
}> = ({ index, eyebrow, title, lines, accent = red, tint, symbol = "", image }) => {
  const frame = useCurrentFrame();
  const move = interpolate(frame, [0, 240], [24, -12], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  return (
    <AbsoluteFill style={{ backgroundColor: base, color: white, fontFamily: font }}>
      <Backdrop tint={tint ?? "#191015"} />
      <AbsoluteFill style={{ padding: "100px 72px 80px", justifyContent: "flex-start" }}>
        <div style={{ opacity: reveal(frame, 4), translate: `0 ${move}px` }}>
          <Eyebrow color={accent}>{index} · {eyebrow}</Eyebrow>
          <div style={{ marginTop: 19, fontSize: 57, fontWeight: 650, letterSpacing: -2.4, lineHeight: 1.04 }}>{title}</div>
          <div style={{ width: 150, height: 3, marginTop: 23, marginBottom: 20, background: `linear-gradient(90deg, ${accent}, transparent)` }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            {lines.map((line, i) => (
              <div key={line} style={{ display: "flex", alignItems: "center", gap: 14, opacity: reveal(frame, 24 + i * 10) }}>
                <span style={{ color: i % 2 ? cyan : accent, fontSize: 22, fontWeight: 700 }}>✦</span>
                <span style={{ fontSize: 26, color: i % 2 ? muted : white, letterSpacing: -0.35 }}>{line}</span>
              </div>
            ))}
          </div>
        </div>
        <FeatureSelector active={index} frame={frame} />
        <div style={{ position: "absolute", left: 55, top: 830, width: 970, height: 625, opacity: reveal(frame, 18), scale: interpolate(frame, [0, 280], [0.975, 1.015], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) }), borderRadius: 28, overflow: "hidden", border: "1px solid rgba(255,255,255,.17)", boxShadow: "0 42px 100px rgba(0,0,0,.58)" }}>
          <Img src={staticFile(image)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
        {symbol && <div style={{ position: "absolute", right: 70, bottom: 52, fontSize: 100, lineHeight: 1, fontWeight: 700, color: "rgba(255,255,255,.035)", letterSpacing: -10 }}>{symbol}</div>}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const featureChapters = [
  { id: "03", label: "Thư viện" },
  { id: "05", label: "Phụ đề kép" },
  { id: "07", label: "Cá nhân hóa" },
  { id: "08", label: "Thiết bị" },
  { id: "09", label: "Xem cùng" },
];

const FeatureSelector: React.FC<{ active: string; frame: number }> = ({ active, frame }) => (
  <div style={{ position: "absolute", top: 690, left: 72, right: 72, display: "flex", gap: 10, opacity: reveal(frame, 12) }}>
    {featureChapters.map((feature) => {
      const selected = feature.id === active;
      return <div key={feature.id} style={{ flex: 1, minWidth: 0, padding: "11px 7px", textAlign: "center", borderRadius: 12, border: `1px solid ${selected ? "rgba(237,28,36,.72)" : "rgba(255,255,255,.12)"}`, background: selected ? "rgba(237,28,36,.16)" : "rgba(8,10,14,.58)", color: selected ? white : muted, fontSize: 15, fontWeight: selected ? 700 : 550, letterSpacing: -0.1, boxShadow: selected ? "0 0 28px rgba(237,28,36,.16)" : "none" }}>
        <span style={{ color: selected ? "#ff5c61" : "#78808b", marginRight: 6 }}>{feature.id}</span>{feature.label}
      </div>;
    })}
  </div>
);

const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const pulse = interpolate(frame, [0, 60, 150], [0.15, 0.5, 0.15], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const enter = reveal(frame, 12);
  return (
    <AbsoluteFill style={{ backgroundColor: base, color: white, fontFamily: font }}>
      <Backdrop />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center", opacity: enter }}>
        <div style={{ position: "absolute", width: 650, height: 650, borderRadius: "50%", background: `radial-gradient(circle, rgba(237,28,36,${pulse}) 0%, transparent 68%)`, filter: "blur(25px)" }} />
        <Wordmark height={78} />
        <div style={{ marginTop: 52, fontSize: 69, fontWeight: 640, lineHeight: 1.04, letterSpacing: -2.5 }}>
          Đi tìm bộ phim tiếp theo.
          <br />
          <span style={{ color: "#ff555c" }}>Ở lại trong câu chuyện.</span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const PlayerAndSubs: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = reveal(frame, 4);
  const scale = interpolate(frame, [0, 300], [1, 1.06], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: base, color: white, fontFamily: font }}>
      <Backdrop tint="#101820" />
      <div style={{ position: "absolute", left: 72, top: 105, opacity: enter }}>
        <Eyebrow color={cyan}>04 · Player & phụ đề kép</Eyebrow>
        <div style={{ marginTop: 24, fontSize: 65, fontWeight: 650, lineHeight: 1.04, letterSpacing: -2.4 }}>
          Theo trọn mạch phim.
          <br />
          <span style={{ color: "#ff5c61" }}>Bắt kịp từng câu thoại.</span>
        </div>
      </div>
      <div style={{ position: "absolute", left: 55, top: 530, width: 970, height: 630, opacity: enter, scale, borderRadius: 28, overflow: "hidden", border: "1px solid rgba(255,255,255,.17)", boxShadow: "0 45px 100px rgba(0,0,0,.62)" }}>
        <Img src={staticFile("framezoo-player-dual.png")} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "center center" }} />
      </div>
      <div style={{ position: "absolute", left: 80, right: 80, bottom: 175, opacity: reveal(frame, 40) }}>
        <div style={{ color: cyan, fontSize: 17, fontWeight: 750, letterSpacing: 2.3 }}>ENGLISH</div>
        <div style={{ marginTop: 7, fontSize: 26, fontWeight: 500 }}>Clause 75A-11: An investigation into relics may be conducted</div>
        <div style={{ height: 1, margin: "17px 0", backgroundColor: "rgba(255,255,255,.14)" }} />
        <div style={{ color: "#ff696f", fontSize: 17, fontWeight: 750, letterSpacing: 2.3 }}>TIẾNG VIỆT</div>
        <div style={{ marginTop: 7, fontSize: 26, fontWeight: 500 }}>Điều khoản 75A-11: Một cuộc điều tra về tàn tích có thể được thực hiện</div>
      </div>
      <div style={{ position: "absolute", left: 85, right: 85, bottom: 82, textAlign: "center", color: muted, fontSize: 19 }}>
        Nguồn phụ đề · dịch · lời thoại · đồng bộ · tùy chỉnh hiển thị
      </div>
    </AbsoluteFill>
  );
};

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: base, color: white, fontFamily: font }}>
      <Backdrop />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", textAlign: "center", opacity: reveal(frame, 7) }}>
        <Wordmark height={74} />
        <div style={{ marginTop: 58, fontSize: 41, fontWeight: 550, lineHeight: 1.34, letterSpacing: 0.2 }}>
          Watch Movies.
          <br />
          Learn Languages.
          <br />
          Experience More.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const FramezooAd: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: base }}>
    <Sequence durationInFrames={150} name="Brand intro"><Intro /></Sequence>
    <Sequence from={150} durationInFrames={360} name="Discovery hero">
      <ScreenScene index="01" eyebrow="Khám phá" title={<>Tìm câu chuyện<br />tiếp theo của bạn.</>} detail="Khám phá phim mới với hình ảnh chủ đạo, thông tin và điểm đánh giá ngay trên trang chủ." tags={["Phim & series", "Siêu dữ liệu", "Đánh giá", "Trailer & thông tin"]} image="prod-discover.png" tint="#171a20" />
    </Sequence>
    <Sequence from={510} durationInFrames={360} name="Native categories">
      <ScreenScene index="02" eyebrow="Danh mục native" title={<>Khám phá theo<br />thể loại yêu thích.</>} detail="Chọn từ các thể loại có sẵn trong FrameZoo và lướt tìm câu chuyện hợp gu." tags={["Hành động", "Phiêu lưu", "Hoạt hình", "Hài"]} image="prod-native-category.png" tint="#151b20" accent={cyan} />
    </Sequence>
    <Sequence from={870} durationInFrames={240} name="Personal library">
      <Interlude index="03" eyebrow="Thư viện cá nhân" title={<>Quay lại đúng<br />chỗ đang xem.</>} lines={["Tiếp tục xem từ tiến độ đã lưu", "Lịch sử xem gần đây", "Đánh dấu phim và sắp xếp thành nhóm"]} image="prod-watch-history.png" tint="#171219" symbol="01" />
    </Sequence>
    <Sequence from={1110} durationInFrames={300} name="Player and dual subtitles"><PlayerAndSubs /></Sequence>
    <Sequence from={1410} durationInFrames={300} name="Language learning">
      <Interlude index="05" eyebrow="Học qua phim" title={<>Nghe nguyên bản.<br /><span style={{ color: "#ff5c61" }}>Hiểu thêm mỗi ngày.</span></>} lines={["Hiển thị hai ngôn ngữ đồng thời", "Tìm phụ đề từ nhiều nguồn", "Dịch, đọc lời thoại và căn chỉnh thời gian"]} image="prod-subtitles.png" accent={red} tint="#1b1014" symbol="A文" />
    </Sequence>
    <Sequence from={1710} durationInFrames={300} name="Playback controls">
      <ScreenScene index="06" eyebrow="Điều khiển & tùy chọn" title={<>Tự chọn cách<br />thưởng thức.</>} detail="Các cài đặt thật của FrameZoo cho phát tập kế, bỏ qua phần cuối, phím tắt và thứ tự danh mục." tags={["Tự động phát", "Bỏ qua credit", "Phím tắt", "Sắp xếp danh mục"]} image="prod-settings-full.png" tint="#151a1d" accent={cyan} />
    </Sequence>
    <Sequence from={2010} durationInFrames={240} name="Personalization and devices">
      <Interlude index="07" eyebrow="Cá nhân hóa" title={<>FrameZoo theo<br />cách bạn xem.</>} lines={["Chọn ngôn ngữ và giao diện", "Tùy chỉnh chữ, màu và vị trí phụ đề", "Picture-in-Picture · AirPlay · Chromecast"]} image="prod-appearance.png" accent={cyan} tint="#111820" symbol="Aa" />
    </Sequence>
    <Sequence from={2250} durationInFrames={240} name="Account sync and watch together">
      <Interlude index="08" eyebrow="Tài khoản & thiết bị" title={<>Quản lý trải nghiệm<br /><span style={{ color: cyan }}>trên các thiết bị.</span></>} lines={["Xem các phiên đăng nhập hiện tại", "Quản lý tài khoản và thiết bị", "Tải dữ liệu hoặc di chuyển tài khoản"]} image="prod-account-devices.png" accent={cyan} tint="#101a20" symbol="∞" />
    </Sequence>
    <Sequence from={2490} durationInFrames={210} name="Watch together">
      <Interlude index="09" eyebrow="Xem cùng bạn bè" title={<>Bấm phát cùng lúc.<br />Chia sẻ khoảnh khắc.</>} lines={["Tham gia phòng bằng liên kết hoặc mã", "Đồng bộ lượt phát để cùng theo dõi"]} image="prod-watchparty.png" accent={cyan} tint="#151821" symbol="↔" />
    </Sequence>
    <Sequence from={2700} durationInFrames={120} name="Brand outro"><Outro /></Sequence>
  </AbsoluteFill>
);
