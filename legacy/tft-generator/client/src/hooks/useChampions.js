import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export function useChampions() {
  const [champions, setChampions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getChampions().then(data => {
      setChampions(data);
      setLoading(false);
    }).catch(err => {
      console.error('Failed to load champions:', err);
      setLoading(false);
    });
  }, []);

  return { champions, loading };
}
