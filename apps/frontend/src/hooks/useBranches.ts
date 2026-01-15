import { useQuery } from '@tanstack/react-query';
import { fetchBranches } from '../services/branch.service';
import { useBranchStore } from '../store/branch.store';
import { useEffect } from 'react';

export const useBranches = () => {
    const { setBranches, setLoading } = useBranchStore();

    const query = useQuery({
        queryKey: ['branches'],
        queryFn: fetchBranches,
    });

    useEffect(() => {
        setLoading(query.isLoading);
        if (query.data) {
            setBranches(query.data);
        }
    }, [query.data, query.isLoading, setBranches, setLoading]);

    return query;
};
