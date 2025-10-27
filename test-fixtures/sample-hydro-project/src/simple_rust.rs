// Simple Rust code with no external dependencies
fn main() {
    let x: i32 = 42;
    let y = "hello";
    println!("{} {}", x, y);
}

struct Point {
    x: f64,
    y: f64,
}

impl Point {
    fn new(x: f64, y: f64) -> Point {
        Point { x, y }
    }
}