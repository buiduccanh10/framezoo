import { useEffect, useState } from "react";

import {
  LANDING_LOCALE_STORAGE_KEY,
  type LandingLocale,
  getInitialLandingLocale,
  getLandingCopy,
  getLandingLocaleOption,
} from "./i18n";
import { LandingFooter, triggerLandingFeedback } from "./LandingFooter";
import { LandingLanguageSelector } from "./LandingLanguageSelector";
import { LandingParticles } from "./LandingParticles";
import "./landing.css";

export type LegalTabId = "terms" | "privacy" | "copyright" | "addon-policy";

interface LegalSectionItem {
  badge: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
}

interface LegalTabContent {
  title: string;
  updatedAt: string;
  summary: string;
  sections: LegalSectionItem[];
}

interface LegalPageCatalog {
  eyebrow: string;
  pageTitle: string;
  pageSubtitle: string;
  reportCtaTitle: string;
  reportCtaDesc: string;
  reportCtaButton: string;
  tabs: Record<LegalTabId, LegalTabContent>;
}

const VI_LEGAL_CATALOG: LegalPageCatalog = {
  eyebrow: "PHÁP LÝ & TUÂN THỦ 2026",
  pageTitle: "Điều khoản, Bảo mật & Chính sách Pháp lý",
  pageSubtitle:
    "Quy định sử dụng, bảo vệ dữ liệu cá nhân và miễn trừ trách nhiệm pháp lý đối với phần mềm trình phát đa phương tiện trung lập Framezoo theo pháp luật Việt Nam hiện hành (2026) và thông lệ quốc tế.",
  reportCtaTitle: "Cần gửi thông báo bản quyền hoặc phản hồi pháp lý?",
  reportCtaDesc:
    "Nếu bạn là chủ sở hữu quyền tác giả hoặc cần yêu cầu hỗ trợ liên quan đến dữ liệu cá nhân, vui lòng gửi thông tin qua biểu mẫu chính thức để đội ngũ xử lý trong 24–72 giờ làm việc.",
  reportCtaButton: "Mở biểu mẫu Báo cáo / Phản hồi",
  tabs: {
    terms: {
      title: "Điều khoản sử dụng (Terms of Service)",
      updatedAt: "Cập nhật hiệu lực: Tháng 10/2026",
      summary:
        "Bằng việc tải xuống, cài đặt hoặc sử dụng trình phát Framezoo, bạn xác nhận đã đọc, hiểu và đồng ý tuân thủ đầy đủ các điều khoản dưới đây.",
      sections: [
        {
          badge: "01",
          title: "Bản chất phần mềm trình phát trung gian kỹ thuật",
          paragraphs: [
            "Framezoo là ứng dụng trình phát đa phương tiện trên máy tính (Desktop Media Player) hoạt động với vai trò công cụ kỹ thuật trung lập, tương tự các trình phát video tiêu chuẩn hoặc trình duyệt web.",
            "Framezoo hoàn toàn KHÔNG lưu trữ (host), KHÔNG tải lên, KHÔNG phát sóng, KHÔNG sản xuất, KHÔNG phân phối và KHÔNG kiểm soát bất kỳ tệp video, luồng phát trực tuyến (video stream) hay tệp phụ đề nào trên máy chủ của mình.",
          ],
        },
        {
          badge: "02",
          title: "Trách nhiệm của người dùng theo pháp luật Việt Nam",
          paragraphs: [
            "Người dùng tự chịu trách nhiệm hoàn toàn trước pháp luật khi cấu hình, cài đặt các tiện ích mở rộng (Addons) hoặc truy cập các đường dẫn luồng phát từ bên thứ ba thông qua ứng dụng.",
          ],
          bullets: [
            "Tuân thủ Luật Sở hữu trí tuệ Việt Nam (sửa đổi), Luật An ninh mạng và Nghị định 147/2024/NĐ-CP về quản lý, cung cấp và sử dụng dịch vụ Internet và thông tin trên mạng.",
            "Không sử dụng phần mềm để truy cập, lưu trữ hoặc chia sẻ các nội dung bị cấm theo quy định của pháp luật Việt Nam và pháp luật tại quốc gia sở tại.",
            "Tự kiểm tra tính hợp pháp và độ an toàn của các Addon cộng đồng trước khi thêm vào ứng dụng.",
          ],
        },
        {
          badge: "03",
          title: "Quyền cấp phép & Giới hạn sử dụng",
          paragraphs: [
            "Framezoo cấp cho bạn quyền sử dụng cá nhân, không độc quyền, không chuyển nhượng và phi thương mại đối với bản cài đặt hợp lệ của phần mềm trên macOS và Windows.",
            "Nghiêm cấm các hành vi dịch ngược trái phép nhằm mục đích cài cắm mã độc, giả mạo thương hiệu Framezoo để trục lợi hoặc gây gián đoạn hạ tầng kỹ thuật của dự án.",
          ],
        },
        {
          badge: "04",
          title: "Giới hạn trách nhiệm pháp lý (AS-IS)",
          paragraphs: [
            "Phần mềm được cung cấp trên cơ sở \"Nguyên trạng\" (AS-IS). Đội ngũ phát triển Framezoo không đưa ra bất kỳ bảo đảm nào về tính liên tục, độ chính xác hoặc tính khả dụng của các nguồn dữ liệu bên thứ ba được kết nối qua giao thức mở.",
          ],
        },
      ],
    },
    privacy: {
      title: "Chính sách bảo mật & Bảo vệ dữ liệu cá nhân",
      updatedAt: "Tuân thủ Luật Bảo vệ dữ liệu cá nhân 2026 & NĐ 13/2023/NĐ-CP",
      summary:
        "Framezoo được thiết kế theo nguyên tắc ưu tiên quyền riêng tư (Privacy-by-Design) và lưu trữ cục bộ (Local-first), thu thập tối thiểu dữ liệu theo đúng quy định của Luật Bảo vệ dữ liệu cá nhân Việt Nam.",
      sections: [
        {
          badge: "01",
          title: "Nguyên tắc lưu trữ cục bộ & Dữ liệu thu thập tối thiểu",
          paragraphs: [
            "Toàn bộ danh sách Addon đã cài, tùy chỉnh giao diện, lịch sử phát và cấu hình đồng bộ phụ đề của bạn được lưu trữ cục bộ trực tiếp trên thiết bị cá nhân của bạn.",
          ],
          bullets: [
            "Thông tin thiết bị cơ bản (Hệ điều hành macOS/Windows, kiến trúc chip) chỉ được kiểm tra cục bộ trên trình duyệt để gợi ý đúng bộ cài đặt tương thích.",
            "Tùy chọn ngôn ngữ hiển thị trên trang chủ được lưu trong bộ nhớ trình duyệt (localStorage).",
            "Nội dung phản hồi, mô tả lỗi và tệp đính kèm chỉ được gửi về hệ thống khi bạn chủ động nhấn gửi trong biểu mẫu Phản hồi.",
          ],
        },
        {
          badge: "02",
          title: "Mục đích xử lý dữ liệu",
          paragraphs: [
            "Chúng tôi chỉ xử lý dữ liệu kỹ thuật và thông tin phản hồi do người dùng tự nguyện cung cấp nhằm mục đích duy nhất: chẩn đoán lỗi phần mềm, nâng cao hiệu năng phát stream và cải thiện trải nghiệm người dùng.",
            "Framezoo cam kết tuyệt đối KHÔNG bán, KHÔNG cho thuê, KHÔNG trao đổi dữ liệu cá nhân của người dùng cho bất kỳ bên thứ ba hay mạng quảng cáo nào.",
          ],
        },
        {
          badge: "03",
          title: "Quyền của Chủ thể dữ liệu tại Việt Nam",
          paragraphs: [
            "Theo Nghị định 13/2023/NĐ-CP và Luật Bảo vệ dữ liệu cá nhân 2026, bạn có đầy đủ các quyền của chủ thể dữ liệu:",
          ],
          bullets: [
            "Quyền được biết và quyền đồng ý/rút lại sự đồng ý đối với hoạt động xử lý dữ liệu.",
            "Quyền xóa toàn bộ dữ liệu cục bộ bất kỳ lúc nào bằng cách gỡ cài đặt ứng dụng hoặc xóa bộ nhớ trình duyệt.",
            "Quyền yêu cầu kiểm tra, chỉnh sửa hoặc xóa vĩnh viễn các bản ghi phản hồi/báo lỗi bạn đã gửi thông qua kênh Phản hồi chính thức.",
          ],
        },
        {
          badge: "04",
          title: "An toàn dữ liệu & Dịch vụ bên thứ ba",
          paragraphs: [
            "Khi bạn kích hoạt các Addon của bên thứ ba, ứng dụng của bạn sẽ gửi yêu cầu HTTP trực tiếp đến máy chủ của Addon đó. Các Addon độc lập này có chính sách bảo mật riêng và nằm ngoài phạm vi kiểm soát của Framezoo.",
          ],
        },
      ],
    },
    copyright: {
      title: "Bản quyền, DMCA & Miễn trừ trách nhiệm nội dung",
      updatedAt: "Tuân thủ Luật SHTT Việt Nam & DMCA 17 U.S.C. § 512",
      summary:
        "Tuyên bố miễn trừ trách nhiệm nội dung và quy trình tiếp nhận thông báo liên quan đến quyền sở hữu trí tuệ.",
      sections: [
        {
          badge: "01",
          title: "Miễn trừ trách nhiệm đối với công cụ phần mềm trung gian",
          paragraphs: [
            "Theo quy định về giới hạn trách nhiệm pháp lý của dịch vụ trung gian kỹ thuật tại Luật Sở hữu trí tuệ Việt Nam (sửa đổi), Nghị định 17/2023/NĐ-CP và Đạo luật Bản quyền Thiên niên kỷ Kỹ thuật số (DMCA), Framezoo chỉ cung cấp trình phát đa phương tiện và không lưu trữ hay truyền dẫn bất kỳ tác phẩm có bản quyền nào.",
            "Mọi luồng video hoặc phụ đề phát trên ứng dụng đều do người dùng tự cung cấp hoặc truy xuất trực tiếp từ các nguồn bên thứ ba độc lập.",
          ],
        },
        {
          badge: "02",
          title: "Nguồn thông tin Metadata & Hình ảnh minh họa",
          paragraphs: [
            "Các thông tin tra cứu về phim (tên phim, năm phát hành, tóm tắt nội dung, điểm số, poster minh họa) hiển thị trên giao diện được trích xuất tự động từ các cơ sở dữ liệu điện ảnh mở (như TMDB, IMDb, TVDB) theo phạm vi sử dụng hợp lý nhằm mục đích thông tin và danh mục.",
            "Nhãn hiệu, tên phim và hình ảnh đại diện thuộc quyền sở hữu của các nhà sản xuất và chủ sở hữu bản quyền tương ứng.",
          ],
        },
        {
          badge: "03",
          title: "Quy trình Thông báo & Gỡ bỏ (Notice & Takedown)",
          paragraphs: [
            "Framezoo tôn trọng quyền tác giả và quyền liên quan của các tổ chức, cá nhân. Nếu bạn là chủ sở hữu quyền hợp pháp và nhận thấy bất kỳ nội dung hiển thị trên website framezoo.top xâm phạm quyền sở hữu trí tuệ của mình, vui lòng gửi yêu cầu kèm theo:",
          ],
          bullets: [
            "Thông tin định danh chủ sở hữu bản quyền hoặc đại diện được ủy quyền hợp pháp.",
            "Bằng chứng xác nhận quyền sở hữu hợp pháp đối với tác phẩm liên quan.",
            "Đường dẫn URL cụ thể hoặc mô tả chi tiết thành phần cần kiểm tra/gỡ bỏ.",
          ],
        },
      ],
    },
    "addon-policy": {
      title: "Chính sách Addon & Nguyên tắc Cộng đồng",
      updatedAt: "Áp dụng cho Nhà phát triển Addon & Người dùng",
      summary:
        "Quy tắc an toàn và tuân thủ pháp luật dành cho hệ sinh thái giao thức Addon mở trên Framezoo.",
      sections: [
        {
          badge: "01",
          title: "Cơ chế giao thức Addon độc lập",
          paragraphs: [
            "Hệ thống Addon của Framezoo sử dụng giao thức HTTP/JSON mở (tương thích chuẩn manifest cộng đồng). Bất kỳ nhà phát triển độc lập nào cũng có thể tự vận hành dịch vụ HTTP riêng mà không cần can thiệp vào mã nguồn của Framezoo.",
            "Framezoo không sở hữu, không lưu trữ máy chủ và không chịu trách nhiệm pháp lý đối với hoạt động của các Addon do bên thứ ba phát triển.",
          ],
        },
        {
          badge: "02",
          title: "Các hành vi bị nghiêm cấm (Tuân thủ Luật An ninh mạng)",
          paragraphs: [
            "Nghiêm cấm các nhà phát triển và người dùng sử dụng giao thức Addon hoặc thương hiệu Framezoo vào các mục đích vi phạm Điều 8 Luật An ninh mạng Việt Nam và Nghị định 147/2024/NĐ-CP, bao gồm:",
          ],
          bullets: [
            "Phát tán nội dung vi phạm pháp luật Việt Nam, tuyên truyền chống phá, kích động bạo lực, đồi trụy hoặc xâm hại trẻ em.",
            "Phát tán mã độc (malware, ransomware, spyware), thực hiện tấn công mạng hoặc đánh cắp dữ liệu người dùng.",
            "Mạo danh đội ngũ phát triển chính thức của Framezoo hoặc lừa đảo thu phí trái phép từ người dùng.",
          ],
        },
        {
          badge: "03",
          title: "Khuyến nghị an toàn cho người dùng",
          paragraphs: [
            "Người dùng chỉ nên cài đặt Addon từ các nhà phát triển uy tín mà mình tin tưởng. Bạn có thể xem chi tiết quyền hạn (`resources`) của từng Addon và gỡ bỏ bất kỳ lúc nào trong phần quản lý Addons của ứng dụng.",
          ],
        },
      ],
    },
  },
};

const EN_LEGAL_CATALOG: LegalPageCatalog = {
  eyebrow: "LEGAL & COMPLIANCE 2026",
  pageTitle: "Terms, Privacy & Legal Policies",
  pageSubtitle:
    "Terms of service, personal data protection, and intermediary software disclaimers for the Framezoo desktop media player in compliance with 2026 Vietnamese regulations and international standards.",
  reportCtaTitle: "Need to submit a copyright notice or legal inquiry?",
  reportCtaDesc:
    "If you are a copyright holder or have a personal data request, please submit your details through our official feedback channel for review within 24–72 business hours.",
  reportCtaButton: "Open Report / Feedback Form",
  tabs: {
    terms: {
      title: "Terms of Service",
      updatedAt: "Effective: October 2026",
      summary:
        "By downloading, installing, or using the Framezoo player, you acknowledge that you have read, understood, and agreed to be bound by these Terms of Service.",
      sections: [
        {
          badge: "01",
          title: "Nature of Neutral Media Player Software",
          paragraphs: [
            "Framezoo is an independent desktop media player application operating as a neutral technical tool, similar to standard video players or web browsers.",
            "Framezoo does NOT host, upload, store, broadcast, distribute, or control any video files, media streams, or subtitle files on its servers.",
          ],
        },
        {
          badge: "02",
          title: "User Responsibilities & Legal Compliance",
          paragraphs: [
            "Users are solely responsible for configuring the application, installing third-party addons, and ensuring that any streams or media accessed comply with applicable laws.",
          ],
          bullets: [
            "Comply with applicable intellectual property laws, the Law on Cybersecurity, Decree 147/2024/ND-CP in Vietnam, and regulations in your local jurisdiction.",
            "Do not use the software to access, distribute, or promote unlawful content.",
            "Verify the trustworthiness and legality of any third-party community addon before installing its manifest URL.",
          ],
        },
        {
          badge: "03",
          title: "Software License & Restrictions",
          paragraphs: [
            "Framezoo grants you a personal, non-exclusive, non-transferable, non-commercial license to install and use the official desktop builds on macOS and Windows.",
            "You may not redistribute modified binaries containing malware, misrepresent affiliation with Framezoo, or abuse project infrastructure.",
          ],
        },
        {
          badge: "04",
          title: "Limitation of Liability (AS-IS)",
          paragraphs: [
            "The software is provided on an \"AS-IS\" and \"AS-AVAILABLE\" basis without warranties of any kind. Framezoo is not liable for the availability, accuracy, or legality of external streams or metadata provided by third-party services.",
          ],
        },
      ],
    },
    privacy: {
      title: "Privacy & Personal Data Protection Policy",
      updatedAt: "Compliant with Vietnam 2026 PDPD Law & Decree 13/2023/ND-CP",
      summary:
        "Framezoo is engineered with Privacy-by-Design and Local-first principles, collecting only minimal technical data in strict compliance with personal data protection laws.",
      sections: [
        {
          badge: "01",
          title: "Local-First Architecture & Data Minimization",
          paragraphs: [
            "Your installed addons, playback preferences, subtitle synchronization settings, and watch history are stored locally on your own device.",
          ],
          bullets: [
            "Basic platform detection (macOS/Windows architecture) runs in your browser solely to recommend the matching desktop installer.",
            "Language preferences on the website are stored locally in your browser's localStorage.",
            "Bug reports, descriptions, and optional attachments are transmitted only when you explicitly submit the Feedback form.",
          ],
        },
        {
          badge: "02",
          title: "Purpose of Data Processing",
          paragraphs: [
            "Voluntarily submitted feedback and diagnostic logs are used exclusively to fix software bugs, optimize streaming performance, and assist users.",
            "Framezoo NEVER sells, rents, or trades user data to third parties or advertising networks.",
          ],
        },
        {
          badge: "03",
          title: "Your Data Subject Rights",
          paragraphs: [
            "In accordance with Vietnam's Personal Data Protection regulations (Decree 13/2023/ND-CP & 2026 PDPD Law) and international privacy standards, you have the right to:",
          ],
          bullets: [
            "Be informed about and consent to or withdraw consent from data processing.",
            "Delete all local application data at any time by uninstalling the app or clearing browser storage.",
            "Request access to, correction of, or permanent deletion of any feedback submission via our official Feedback form.",
          ],
        },
        {
          badge: "04",
          title: "Third-Party Addon Services",
          paragraphs: [
            "When you install and query third-party addons, your client communicates directly with those external HTTP endpoints. Third-party addons are governed by their own respective privacy policies.",
          ],
        },
      ],
    },
    copyright: {
      title: "Copyright, DMCA & Content Disclaimer",
      updatedAt: "Compliant with IP Law & DMCA 17 U.S.C. § 512",
      summary:
        "Official content disclaimer and intellectual property notice-and-takedown procedure for Framezoo.",
      sections: [
        {
          badge: "01",
          title: "Intermediary Software Safe Harbor",
          paragraphs: [
            "Under the intermediary service provisions of the Vietnamese Intellectual Property Law, Decree 17/2023/ND-CP, and the Digital Millennium Copyright Act (DMCA 17 U.S.C. § 512), Framezoo acts strictly as a client-side media player and does not host, cache, or transmit copyrighted media streams.",
            "All media playback and external streams are initiated by end users through independent third-party sources.",
          ],
        },
        {
          badge: "02",
          title: "Metadata & Artwork Attribution",
          paragraphs: [
            "Movie and series metadata (titles, release dates, synopses, ratings, and promotional posters) displayed for informational discovery are sourced from public movie databases (such as TMDB, IMDb, and TVDB).",
            "All trademarks, movie titles, and artwork remain the property of their respective copyright owners.",
          ],
        },
        {
          badge: "03",
          title: "Notice & Takedown Procedure",
          paragraphs: [
            "Framezoo respects intellectual property rights. If you are a copyright owner or authorized agent and believe any material on framezoo.top infringes your rights, please submit a notice via our Report / Feedback channel including:",
          ],
          bullets: [
            "Identification of the copyright owner or authorized representative.",
            "Proof of ownership of the copyrighted work.",
            "The exact URL or description of the material in question so we can review and address it within 24–72 business hours.",
          ],
        },
      ],
    },
    "addon-policy": {
      title: "Addon Policy & Community Guidelines",
      updatedAt: "For Addon Developers & End Users",
      summary:
        "Safety and compliance standards for the open HTTP/JSON addon ecosystem on Framezoo.",
      sections: [
        {
          badge: "01",
          title: "Independent Addon Architecture",
          paragraphs: [
            "Framezoo supports an open HTTP/JSON addon protocol. Independent developers can host their own manifest and resource endpoints without modifying the core player.",
            "Framezoo does not endorse, verify, or assume liability for third-party community addons.",
          ],
        },
        {
          badge: "02",
          title: "Prohibited Conduct & Content",
          paragraphs: [
            "In compliance with cybersecurity and intellectual property regulations, developers and users must not use the Framezoo protocol or branding to:",
          ],
          bullets: [
            "Distribute unlawful content, hate speech, violence, or child exploitation material.",
            "Spread malware, spyware, phishing links, or unauthorized data harvesting scripts.",
            "Impersonate official Framezoo releases or deceive users with fraudulent payment schemes.",
          ],
        },
        {
          badge: "03",
          title: "User Safety Recommendations",
          paragraphs: [
            "Only install addon manifests from sources you trust. You can inspect declared addon resources and remove any installed addon at any time within the Framezoo app.",
          ],
        },
      ],
    },
  },
};

export function getLegalTabFromPathname(pathname: string): LegalTabId | null {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized === "/legal" || normalized === "/legal/terms" || normalized === "/terms") {
    return "terms";
  }
  if (normalized === "/legal/privacy" || normalized === "/privacy") {
    return "privacy";
  }
  if (
    normalized === "/legal/copyright" ||
    normalized === "/legal/dmca" ||
    normalized === "/copyright" ||
    normalized === "/dmca"
  ) {
    return "copyright";
  }
  if (normalized === "/legal/addon-policy" || normalized === "/addon-policy") {
    return "addon-policy";
  }
  return null;
}

export function LegalPage({ initialTab = "terms" }: { initialTab?: LegalTabId }) {
  const [locale, setLocale] = useState<LandingLocale>(getInitialLandingLocale);
  const [activeTab, setActiveTab] = useState<LegalTabId>(initialTab);
  const activeCopy = getLandingCopy(locale);
  const catalog = locale === "vi" ? VI_LEGAL_CATALOG : EN_LEGAL_CATALOG;
  const activeDocument = catalog.tabs[activeTab];

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir =
      getLandingLocaleOption(locale)?.direction ?? "ltr";
    document.title = `${activeDocument.title} | Framezoo`;

    try {
      window.localStorage.setItem(LANDING_LOCALE_STORAGE_KEY, locale);
    } catch {
      // Storage unavailable
    }
  }, [activeDocument.title, locale]);

  const handleSelectTab = (tab: LegalTabId) => {
    setActiveTab(tab);
    if (typeof window !== "undefined") {
      window.history.pushState({}, "", `/legal/${tab}`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <div className="landing-shell landing-legal-shell">
      <div className="landing-ambient landing-ambient-one" aria-hidden="true" />
      <div className="landing-ambient landing-ambient-two" aria-hidden="true" />
      <LandingParticles />

      <header className="landing-nav">
        <a className="landing-brand" href="/" aria-label="Framezoo home">
          <img
            src="/framezoo-logo.svg"
            width="138"
            height="40"
            alt="Framezoo"
          />
        </a>
        <nav className="landing-nav-links" aria-label="Primary navigation">
          <a href="/">{activeCopy.nav.home}</a>
          <a href="/experience">{activeCopy.nav.features}</a>
          <a href="/ecosystem">{activeCopy.nav.addons}</a>
          <a href="/create-addon">{activeCopy.nav.addonGuide}</a>
          <a href="/download">{activeCopy.nav.download}</a>
          <a href="/guide/install">{activeCopy.nav.installGuide}</a>
          <LandingLanguageSelector
            locale={locale}
            label={activeCopy.nav.language}
            onChange={setLocale}
          />
        </nav>
      </header>

      <main className="legal-page-main">
        <header className="legal-page-header">
          <span className="landing-eyebrow">{catalog.eyebrow}</span>
          <h1>{catalog.pageTitle}</h1>
          <p>{catalog.pageSubtitle}</p>

          <div
            className="legal-page-tabs"
            role="tablist"
            aria-label={activeCopy.footer.legalTitle}
          >
            {(
              [
                ["terms", activeCopy.footer.terms],
                ["privacy", activeCopy.footer.privacy],
                ["copyright", activeCopy.footer.copyright],
                ["addon-policy", activeCopy.footer.addonPolicy],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                className={`legal-page-tab ${activeTab === id ? "is-active" : ""}`}
                onClick={() => handleSelectTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        <article className="legal-document-card">
          <header className="legal-document-header">
            <span className="legal-document-updated">{activeDocument.updatedAt}</span>
            <h2>{activeDocument.title}</h2>
            <p className="legal-document-summary">{activeDocument.summary}</p>
          </header>

          <div className="legal-document-sections">
            {activeDocument.sections.map((section) => (
              <section key={section.badge} className="legal-section-block">
                <div className="legal-section-heading">
                  <span className="legal-section-badge">{section.badge}</span>
                  <h3>{section.title}</h3>
                </div>
                <div className="legal-section-body">
                  {section.paragraphs.map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                  {section.bullets && (
                    <ul className="legal-section-bullets">
                      {section.bullets.map((bullet, index) => (
                        <li key={index}>{bullet}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            ))}
          </div>

          <aside className="legal-contact-banner">
            <div>
              <h3>{catalog.reportCtaTitle}</h3>
              <p>{catalog.reportCtaDesc}</p>
            </div>
            <button
              type="button"
              className="landing-button landing-button-primary"
              onClick={triggerLandingFeedback}
            >
              {catalog.reportCtaButton}
            </button>
          </aside>
        </article>
      </main>

      <LandingFooter copy={activeCopy} />
    </div>
  );
}
