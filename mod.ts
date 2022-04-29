export type {
    BlockInfo,
    PageData,
    ScrapInfo,
    ToBlockInput,
    TokenizeError,
    UnitScrap,
} from "./base_types.ts"

export {
    arrange_children,
    create_block,
    nest_count,
    plaintx_to_richtx,
    set_annos,    
    set_record_and_get_childs,
    to_richtx,
} from "./html_to_blocks.ts"

export {
    zenn_article_to_blocks,
    zenn_scrap_to_blocks,
} from "./functions_zenn.ts"

export { note_article_to_blocks } from "./functions_note.ts"


export const TEX_TAGS = ["EMBED-KATEX", "NWC-FORMULA"]

export const VALID_LANGNAME = ["abap", "arduino", "bash", "basic", "c", "clojure", "coffeescript", "c++", "c#", "css", "dart", "diff", "docker", "elixir", "elm", "erlang", "flow", "fortran", "f#", "gherkin", "glsl", "go", "graphql", "groovy", "haskell", "html", "java", "javascript", "json", "julia", "kotlin", "latex", "less", "lisp", "livescript", "lua", "makefile", "markdown", "markup", "matlab", "mermaid", "nix", "objective-c", "ocaml", "pascal", "perl", "php", "plain text", "powershell", "prolog", "protobuf", "python", "r", "reason", "ruby", "rust", "sass", "scala", "scheme", "scss", "shell", "solidity", "sql", "swift", "typescript", "vb.net", "verilog", "vhdl", "visual basic", "webassembly", "xml", "yaml", "java/c/c++/c#"]

export const VALID_IMAGEFILE = ["png", "jpg", "jpeg", "gif", "tif", "tiff", "bmp", "svg", "heic"]