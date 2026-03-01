import { useState, useEffect } from 'react';
import { Search, Loader2, X } from 'lucide-react';

interface GifPickerProps {
    onSelect: (url: string) => void;
    onClose: () => void;
}

export default function GifPicker({ onSelect, onClose }: GifPickerProps) {
    const [gifs, setGifs] = useState<string[]>([]);
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        fetchGifs('');
    }, []);

    const fetchGifs = async (q: string) => {
        setLoading(true);
        try {
            const url = q
                ? `https://g.tenor.com/v1/search?q=${encodeURIComponent(q)}&key=LIVDSRZULELA&limit=30`
                : `https://g.tenor.com/v1/trending?key=LIVDSRZULELA&limit=30`;
            const res = await fetch(url);
            const data = await res.json();
            const urls = data.results.map((r: any) => r.media[0].gif.url);
            setGifs(urls);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{
            width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
            background: 'var(--bg-1)', borderRadius: '12px', overflow: 'hidden'
        }}>
            <div style={{ display: 'flex', padding: '12px', borderBottom: '1px solid var(--border)', alignItems: 'center', gap: '8px' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                    <input
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && fetchGifs(query)}
                        placeholder="Search Tenor..."
                        style={{
                            width: '100%', padding: '8px 12px', paddingRight: '36px',
                            borderRadius: '20px', border: '1px solid var(--border)',
                            background: 'var(--bg-2)', color: 'var(--text)',
                            outline: 'none', fontSize: '0.9rem'
                        }}
                    />
                    <button
                        onClick={() => fetchGifs(query)}
                        style={{
                            position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)',
                            background: 'none', border: 'none', color: 'var(--text-2)', cursor: 'pointer'
                        }}
                    >
                        <Search size={16} />
                    </button>
                </div>
                <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-2)', cursor: 'pointer', padding: '4px' }}>
                    <X size={20} />
                </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
                {loading ? (
                    <div style={{ gridColumn: 'span 2', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '150px' }}>
                        <Loader2 className="spinner" size={24} color="var(--text-3)" />
                    </div>
                ) : gifs.map((url, i) => (
                    <img key={i} src={url} alt="gif" onClick={() => onSelect(url)}
                        style={{
                            width: '100%', height: '120px', objectFit: 'cover', borderRadius: '8px',
                            cursor: 'pointer', border: '2px solid transparent', transition: 'border 0.2s'
                        }}
                        onMouseOver={e => e.currentTarget.style.borderColor = 'var(--blue)'}
                        onMouseOut={e => e.currentTarget.style.borderColor = 'transparent'}
                    />
                ))}
            </div>
        </div>
    );
}
