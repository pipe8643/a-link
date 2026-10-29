import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LetterheadFrame } from "./letterhead-frame";

describe("LetterheadFrame", () => {
  it("sin imagen deja el visor en blanco", () => {
    const { container } = render(
      <LetterheadFrame>
        <p>grafo</p>
      </LetterheadFrame>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("grafo")).toBeInTheDocument();
  });

  it("pinta el membrete a tamaño completo, sin recortar", () => {
    render(
      <LetterheadFrame src="blob:https://localhost/letterhead">
        <p>grafo</p>
      </LetterheadFrame>,
    );
    const img = screen.getByAltText("") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("blob:https://localhost/letterhead");
    expect(img).toHaveClass("object-fill");
    expect(screen.getByText("grafo")).toBeInTheDocument();
  });
});
