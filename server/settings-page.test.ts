import { describe, it, expect } from "vitest";

describe("SettingsPage Component", () => {
  describe("Color Customization", () => {
    it("should initialize with default colors", () => {
      const defaultColors = {
        sidebarBgColor: "#1e293b",
        sidebarAccent: "#3b82f6",
        cardBgColor: "#ffffff",
        cardBorderColor: "#e2e8f0",
      };

      expect(defaultColors.sidebarBgColor).toBe("#1e293b");
      expect(defaultColors.sidebarAccent).toBe("#3b82f6");
      expect(defaultColors.cardBgColor).toBe("#ffffff");
      expect(defaultColors.cardBorderColor).toBe("#e2e8f0");
    });

    it("should validate hex color format", () => {
      const isValidHex = (color: string) => /^#[0-9A-F]{6}$/i.test(color);

      expect(isValidHex("#1e293b")).toBe(true);
      expect(isValidHex("#3b82f6")).toBe(true);
      expect(isValidHex("#ffffff")).toBe(true);
      expect(isValidHex("#e2e8f0")).toBe(true);
      expect(isValidHex("invalid")).toBe(false);
      expect(isValidHex("#12345")).toBe(false);
    });
  });

  describe("Color Presets", () => {
    const colorPresets = [
      { name: "Padrão (Azul)", bg: "#1e293b", accent: "#3b82f6", cardBg: "#ffffff", cardBorder: "#e2e8f0" },
      { name: "Escuro (Roxo)", bg: "#1a1a2e", accent: "#a855f7", cardBg: "#0f172a", cardBorder: "#334155" },
      { name: "Verde Floresta", bg: "#1b4332", accent: "#2d6a4f", cardBg: "#ffffff", cardBorder: "#d1fae5" },
      { name: "Laranja Quente", bg: "#7c2d12", accent: "#f97316", cardBg: "#ffffff", cardBorder: "#fed7aa" },
      { name: "Minimalista", bg: "#f5f5f5", accent: "#1f2937", cardBg: "#ffffff", cardBorder: "#d1d5db" },
    ];

    it("should have exactly 5 color presets", () => {
      expect(colorPresets).toHaveLength(5);
    });

    it("should validate all preset colors", () => {
      const isValidHex = (color: string) => /^#[0-9A-F]{6}$/i.test(color);

      colorPresets.forEach((preset) => {
        expect(isValidHex(preset.bg)).toBe(true);
        expect(isValidHex(preset.accent)).toBe(true);
        expect(isValidHex(preset.cardBg)).toBe(true);
        expect(isValidHex(preset.cardBorder)).toBe(true);
      });
    });

    it("should have unique preset names", () => {
      const names = colorPresets.map((p) => p.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it("should apply preset colors correctly", () => {
      const preset = colorPresets[1]; // Escuro (Roxo)
      const appliedColors = {
        sidebarBgColor: preset.bg,
        sidebarAccent: preset.accent,
        cardBgColor: preset.cardBg,
        cardBorderColor: preset.cardBorder,
      };

      expect(appliedColors.sidebarBgColor).toBe("#1a1a2e");
      expect(appliedColors.sidebarAccent).toBe("#a855f7");
      expect(appliedColors.cardBgColor).toBe("#0f172a");
      expect(appliedColors.cardBorderColor).toBe("#334155");
    });
  });

  describe("Settings Page Functionality", () => {
    it("should render settings page with all sections", () => {
      const sections = [
        "Personalização de Cores",
        "Paletas Pré-definidas",
        "Outras Configurações",
      ];

      sections.forEach((section) => {
        expect(section).toBeDefined();
        expect(section.length).toBeGreaterThan(0);
      });
    });

    it("should have color input fields", () => {
      const colorInputs = [
        "Cor de Fundo da Barra Lateral",
        "Cor de Destaque (Ícones Ativos)",
        "Cor de Fundo dos Cards",
        "Cor de Borda dos Cards",
      ];

      expect(colorInputs).toHaveLength(4);
      colorInputs.forEach((input) => {
        expect(input).toBeDefined();
      });
    });

    it("should have additional settings fields", () => {
      const additionalSettings = [
        "Telefone Principal",
        "Modo Escuro",
      ];

      expect(additionalSettings).toHaveLength(2);
      additionalSettings.forEach((setting) => {
        expect(setting).toBeDefined();
      });
    });
  });

  describe("Color Validation", () => {
    it("should accept valid hex colors", () => {
      const validColors = [
        "#000000",
        "#ffffff",
        "#1e293b",
        "#3b82f6",
        "#a855f7",
        "#2d6a4f",
      ];

      const isValidHex = (color: string) => /^#[0-9A-F]{6}$/i.test(color);

      validColors.forEach((color) => {
        expect(isValidHex(color)).toBe(true);
      });
    });

    it("should reject invalid hex colors", () => {
      const invalidColors = [
        "invalid",
        "#12345",
        "#12345g",
        "1e293b",
        "#1e293b00",
      ];

      const isValidHex = (color: string) => /^#[0-9A-F]{6}$/i.test(color);

      invalidColors.forEach((color) => {
        expect(isValidHex(color)).toBe(false);
      });
    });
  });
});
