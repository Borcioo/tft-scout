import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export function useTraits() {
  const [traits, setTraits] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getTraits().then(data => {
      setTraits(data);
      setLoading(false);
    }).catch(err => {
      console.error('Failed to load traits:', err);
      setLoading(false);
    });
  }, []);

  return { traits, loading };
}
