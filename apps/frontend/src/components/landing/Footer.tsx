import { Link } from "react-router-dom";

export const Footer = () => {
    return (
        <footer className="bg-zinc-50 border-t border-zinc-200">
            <div className="container mx-auto px-4 lg:px-8 py-12 md:py-16">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-8">
                    {/* Brand Column */}
                    <div className="col-span-2 md:col-span-2">
                        <Link to="/" className="flex items-center gap-2.5 mb-4">
                            <div className="flex aspect-square size-9 items-center justify-center rounded-lg bg-orange-500 text-white">
                                <svg
                                    xmlns="http://www.w3.org/2000/svg"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="size-5"
                                >
                                    <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2" />
                                    <circle cx="7" cy="17" r="2" />
                                    <path d="M9 17h6" />
                                    <circle cx="17" cy="17" r="2" />
                                </svg>
                            </div>
                            <span className="text-lg font-bold text-zinc-900">VRMS</span>
                        </Link>
                        <p className="text-sm text-zinc-600 max-w-xs leading-relaxed">
                            Redefining mobility with a premium fleet and exceptional service. Drive the extraordinary.
                        </p>
                    </div>

                    {/* Company Links */}
                    <div>
                        <h4 className="text-sm font-semibold text-zinc-900 mb-4">Company</h4>
                        <ul className="space-y-3">
                            <li><Link to="#" className="text-sm text-zinc-600 hover:text-orange-500 transition-colors">About Us</Link></li>
                            <li><Link to="#" className="text-sm text-zinc-600 hover:text-orange-500 transition-colors">Careers</Link></li>
                            <li><Link to="#" className="text-sm text-zinc-600 hover:text-orange-500 transition-colors">Press</Link></li>
                        </ul>
                    </div>

                    {/* Support Links */}
                    <div>
                        <h4 className="text-sm font-semibold text-zinc-900 mb-4">Support</h4>
                        <ul className="space-y-3">
                            <li><Link to="#" className="text-sm text-zinc-600 hover:text-orange-500 transition-colors">Help Center</Link></li>
                            <li><Link to="#" className="text-sm text-zinc-600 hover:text-orange-500 transition-colors">Terms of Service</Link></li>
                            <li><Link to="#" className="text-sm text-zinc-600 hover:text-orange-500 transition-colors">Privacy Policy</Link></li>
                        </ul>
                    </div>

                    {/* Social Links */}
                    <div>
                        <h4 className="text-sm font-semibold text-zinc-900 mb-4">Social</h4>
                        <div className="flex items-center gap-3">
                            <a href="#" className="size-9 flex items-center justify-center rounded-full bg-zinc-900 text-white hover:bg-orange-500 transition-colors">
                                <svg className="size-4" fill="currentColor" viewBox="0 0 24 24"><path d="M24 4.557c-.883.392-1.832.656-2.828.775 1.017-.609 1.798-1.574 2.165-2.724-.951.564-2.005.974-3.127 1.195-.897-.957-2.178-1.555-3.594-1.555-3.179 0-5.515 2.966-4.797 6.045-4.091-.205-7.719-2.165-10.148-5.144-1.29 2.213-.669 5.108 1.523 6.574-.806-.026-1.566-.247-2.229-.616-.054 2.281 1.581 4.415 3.949 4.89-.693.188-1.452.232-2.224.084.626 1.956 2.444 3.379 4.6 3.419-2.07 1.623-4.678 2.348-7.29 2.04 2.179 1.397 4.768 2.212 7.548 2.212 9.142 0 14.307-7.721 13.995-14.646.962-.695 1.797-1.562 2.457-2.549z" /></svg>
                            </a>
                            <a href="#" className="size-9 flex items-center justify-center rounded-full bg-zinc-900 text-white hover:bg-orange-500 transition-colors">
                                <svg className="size-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm3 8h-1.35c-.538 0-.65.221-.65.778v1.222h2l-.209 2h-1.791v7h-3v-7h-2v-2h2v-2.308c0-1.769.931-2.692 3.029-2.692h1.971v3z" /></svg>
                            </a>
                        </div>
                    </div>
                </div>

                {/* Bottom Bar */}
                <div className="mt-12 pt-8 border-t border-zinc-200 flex flex-col md:flex-row justify-between items-center gap-4">
                    <p className="text-xs text-zinc-500">
                        © {new Date().getFullYear()} VRMS Inc. All rights reserved.
                    </p>
                    <div className="flex items-center gap-1 text-xs text-zinc-500">
                        <span>English (US)</span>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="size-4">
                            <path fillRule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
                        </svg>
                    </div>
                </div>
            </div>
        </footer>
    );
};
