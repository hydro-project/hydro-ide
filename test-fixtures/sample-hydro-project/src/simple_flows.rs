/// Simple Hydro flows for function-level visualization testing
use dfir_rs::dfir_syntax;
use dfir_rs::scheduled::graph::Dfir;

/// A simple "Hello World" flow
/// 
/// This is the simplest possible Hydro flow - it just prints messages.
/// Use this to test basic function-level visualization.
pub fn hello_world_flow() -> Dfir<'static> {
    dfir_syntax! {
        source_iter(["Hello", "World", "from", "Hydro"])
            -> map(|s: &str| s.to_uppercase())
            -> for_each(|s| println!("{}", s));
    }
}

/// A flow that filters and transforms data
/// 
/// This flow demonstrates filtering, mapping, and aggregation.
pub fn filter_and_count_flow() -> Dfir<'static> {
    dfir_syntax! {
        source_iter(0..100)
            -> filter(|n| n % 2 == 0)
            -> map(|n| n * 2)
            -> fold::<'static>(|| 0, |acc, n| *acc += n)
            -> for_each(|sum| println!("Sum of even numbers doubled: {}", sum));
    }
}

/// A flow with multiple branches (tee)
/// 
/// This demonstrates how data can be split into multiple pipelines.
pub fn branching_flow() -> Dfir<'static> {
    dfir_syntax! {
        source = source_iter(1..=10) -> tee();
        
        // Branch 1: Print even numbers
        source[0]
            -> filter(|n| n % 2 == 0)
            -> for_each(|n| println!("Even: {}", n));
        
        // Branch 2: Print odd numbers
        source[1]
            -> filter(|n| n % 2 != 0)
            -> for_each(|n| println!("Odd: {}", n));
    }
}

/// A flow with union (merging streams)
/// 
/// This demonstrates combining multiple data sources.
pub fn union_flow() -> Dfir<'static> {
    dfir_syntax! {
        merged = union();
        
        source_iter(1..=5) -> map(|n| format!("A{}", n)) -> [0]merged;
        source_iter(1..=5) -> map(|n| format!("B{}", n)) -> [1]merged;
        
        merged -> for_each(|s| println!("{}", s));
    }
}

/// A flow with join operation
/// 
/// This demonstrates joining two streams on a key.
pub fn join_flow() -> Dfir<'static> {
    dfir_syntax! {
        // Stream of (id, name) pairs
        names = source_iter([
            (1, "Alice"),
            (2, "Bob"),
            (3, "Charlie"),
        ]);
        
        // Stream of (id, age) pairs
        ages = source_iter([
            (1, 30),
            (2, 25),
            (3, 35),
        ]);
        
        // Join on id
        joined = join::<'tick>();
        names -> [0]joined;
        ages -> [1]joined;
        
        joined
            -> for_each(|(id, (name, age))| {
                println!("ID: {}, Name: {}, Age: {}", id, name, age);
            });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hello_world() {
        let mut flow = hello_world_flow();
        flow.run_available_sync();
    }

    #[test]
    fn test_filter_and_count() {
        let mut flow = filter_and_count_flow();
        flow.run_available_sync();
    }

    #[test]
    fn test_branching() {
        let mut flow = branching_flow();
        flow.run_available_sync();
    }

    #[test]
    fn test_union() {
        let mut flow = union_flow();
        flow.run_available_sync();
    }

    #[test]
    fn test_join() {
        let mut flow = join_flow();
        flow.run_available_sync();
    }
}
