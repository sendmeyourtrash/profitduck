"use client";

import AliasManager from "./AliasManager";

export default function MenuCategoryAliasesPanel() {
  return (
    <AliasManager
      config={{
        apiEndpoint: "/api/menu-category-aliases",
        entityLabel: "Category",
        patternPlaceholder: "e.g. Menu - Sweet Crêpes",
        displayPlaceholder: "e.g. Sweet Crêpes",
        ignoreFieldName: "categoryName",
      }}
    />
  );
}
