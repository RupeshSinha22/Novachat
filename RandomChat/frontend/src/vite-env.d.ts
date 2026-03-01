/// <reference types="vite/client" />

interface Window {
    Razorpay: new (options: any) => {
        open: () => void;
        on: (event: string, callback: (response: any) => void) => void;
    };
}
