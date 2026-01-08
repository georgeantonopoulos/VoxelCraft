/// <reference types="vite/client" />

declare module '*.jpg' {
    const src: string;
    export default src;
}

declare module '*.png' {
    const src: string;
    export default src;
}

declare module '*.glb?url' {
    const src: string;
    export default src;
}
